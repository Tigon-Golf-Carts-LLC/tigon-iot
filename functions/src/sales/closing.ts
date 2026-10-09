// Track 3 — Closing tools (ideas 6, 7, 8, 9): pre-qualification, quote links, trade-in estimates, test-drive booking.
// Public pages call closingPublic through /api/public/<area>/<action>[/<rest>] (public.ts). Every public handler
// validates and size-limits its input, never returns another customer's data, and creates or attaches leads with the
// Admin SDK. Queries use single-field indexes only (one field, or several == filters).
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import {randomUUID} from 'crypto';
import type {SalesSettings, WeekDay} from './settings';
import {loadSalesSettings} from './settings';
import {PublicError} from './publicTypes';
import type {PublicHandler} from './publicTypes';
import {queueSms} from './outbox';
import {
  C, DAY_MS, HOUR_MS, MIN_MS, PUBLIC_ORIGIN, cartSummary, clean, db, e164, fill, firstName, leadTemplateData, loadPeople,
  managersFor, notify, nyDateKey, nyParts, nyTime, nyWhen, prettyPhone, storeCity, storeOf,
} from './util';
import type {Json, Person} from './util';
import {STORES} from '../mpShare';

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
/** Trimmed text without control characters, at most `max` characters. */
export const str = (v: unknown, max: number) => String(v ?? '').replace(CTRL, ' ').trim().slice(0, max);

function reqName(v: unknown): string {
  const s = str(v, 80).replace(/\s+/g, ' ');
  if (s.length < 2) throw new PublicError(400, 'Please enter your name.');
  return s;
}
function reqPhone(v: unknown): string {
  const p = e164(str(v, 30));
  if (!p) throw new PublicError(400, 'Please enter a 10-digit phone number.');
  return p;
}
function optEmail(v: unknown): string {
  const s = str(v, 120);
  if (!s) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new PublicError(400, 'That email address doesn\'t look right.');
  return s.toLowerCase();
}
/** Whole dollars, 0..max ('' or junk → 0). */
const dollars = (v: unknown, max: number) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), max) : 0;
};
/** A real store id (T1…T14), else ''. */
export const storeIdOf = (v: unknown) => {
  const s = str(v, 8).toUpperCase();
  return s !== 'T0' && STORES.some((x) => x.id === s) ? s : '';
};
/** Firestore-safe document id from a link, else ''. */
export const docIdOf = (v: unknown) => {
  const s = str(v, 128);
  return /^[A-Za-z0-9_-]{1,128}$/.test(s) ? s : '';
};
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const httpsUrl = (v: unknown) => {
  const s = str(v, 500);
  return /^https:\/\/[^\s]+$/i.test(s) ? s : '';
};

// ---------------------------------------------------------------------------
// Leads: attach to an open lead with the same phone, or create one
// ---------------------------------------------------------------------------

const OPEN = new Set(['new', 'talking']);

/** Every way a phone number may have been typed into a lead. */
export function phoneForms(raw: string): string[] {
  const e = e164(raw);
  const out = new Set<string>([str(raw, 30)]);
  if (e) {
    const d = e.slice(2);
    out.add(e).add(prettyPhone(e)).add(d).add(`1${d}`).add(`${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`)
      .add(`(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`).add(`${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`);
  }
  return [...out].filter(Boolean);
}

/** Most recently updated open lead with this phone number (equality queries only). */
export async function findOpenLeadByPhone(raw: string): Promise<{id: string; data: Json} | null> {
  const snaps = await Promise.all(phoneForms(raw).map((p) => db().collection(C.leads).where('phone', '==', p).limit(20).get()));
  const hits = new Map<string, Json>();
  for (const s of snaps) for (const d of s.docs) if (OPEN.has(String(d.get('status') || 'new'))) hits.set(d.id, d.data());
  let best: {id: string; data: Json} | null = null;
  for (const [id, data] of hits) {
    if (!best || Number(data.updatedAt || data.createdAt || 0) > Number(best.data.updatedAt || best.data.createdAt || 0)) best = {id, data};
  }
  return best;
}

/** Who gets a new public lead: the salesperson from the link/quote, else the store's manager, else the first admin. */
export function pickOwner(people: Person[], storeId: string, hint?: string): string {
  if (hint && people.some((p) => p.uid === hint)) return hint;
  return managersFor(people, storeId || undefined)[0]?.uid || people.find((p) => p.role === 'admin')?.uid || '';
}

const appendNote = (notes: unknown, line: string) => {
  const cur = String(notes || '').trim();
  const stamp = new Date().toLocaleDateString('en-US', {timeZone: 'America/New_York', month: 'short', day: 'numeric'});
  return `${cur ? `${cur}\n` : ''}${stamp}: ${line}`.slice(-4000);
};

export interface LeadIn {
  name: string;
  /** +1XXXXXXXXXX */
  phone: string;
  email?: string;
  source: 'quote' | 'booking' | 'trade_in' | 'prequal';
  storeId?: string;
  /** Lead id from the link (?lead=…). */
  leadId?: string;
  /** Salesperson uid from the link / quote. */
  ownerHint?: string;
  cartId?: string;
  cartTitle?: string;
  /** One line added to the lead's notes. */
  note: string;
  /** Fields set on the lead (prequalId, tradeValue, appointmentAt, …). */
  patch: Json;
  /** Notification for the owner. */
  notifyText: string;
  /** Others to notify too (e.g. store managers). */
  alsoNotify?: string[];
}

/** Attaches to the lead from the link or an open lead with the same phone; otherwise creates a website lead. */
export async function attachOrCreateLead(i: LeadIn): Promise<{leadId: string; ownerUid: string; created: boolean}> {
  const now = Date.now();
  const col = db().collection(C.leads);
  let target: {id: string; data: Json} | null = null;
  if (i.leadId) {
    const s = await col.doc(i.leadId).get();
    if (s.exists) target = {id: s.id, data: s.data() || {}};
  }
  if (!target) target = await findOpenLeadByPhone(i.phone);
  const people = await loadPeople();
  let leadId: string;
  let ownerUid: string;
  let created = false;
  if (target) {
    leadId = target.id;
    const d = target.data;
    ownerUid = String(d.ownerUid || '') || pickOwner(people, i.storeId || String(d.locationId || ''), i.ownerHint);
    await col.doc(leadId).update(clean({
      ...i.patch,
      notes: appendNote(d.notes, i.note),
      updatedAt: now,
      ownerUid: d.ownerUid ? undefined : ownerUid || undefined,
      locationId: d.locationId ? undefined : i.storeId || undefined,
      email: d.email ? undefined : i.email || undefined,
      cartId: d.cartId || !i.cartId ? undefined : i.cartId,
      cartTitle: d.cartId || !i.cartId ? undefined : i.cartTitle || undefined,
      // A lost lead that comes back is a live lead again.
      status: OPEN.has(String(d.status || 'new')) || d.status === 'sold' ? undefined : 'new',
    }));
  } else {
    ownerUid = pickOwner(people, i.storeId || '', i.ownerHint);
    const ref = col.doc();
    leadId = ref.id;
    created = true;
    await ref.set(clean({
      name: i.name, phone: prettyPhone(i.phone), email: i.email || '', channel: 'website', source: i.source, status: 'new',
      ownerUid, locationId: i.storeId || '', notes: appendNote('', i.note), cartId: i.cartId || undefined,
      cartTitle: i.cartId ? i.cartTitle || undefined : undefined, createdAt: now, updatedAt: now, ...i.patch,
    }));
  }
  const targets = new Set([ownerUid, ...(i.alsoNotify || [])].filter(Boolean));
  await Promise.all([...targets].map((uid) => notify(uid, 'TIGON website', i.notifyText, {source: 'sales_closing', leadId, kind: i.source})));
  return {leadId, ownerUid, created};
}

// ---------------------------------------------------------------------------
// 8. Trade-in estimate
// ---------------------------------------------------------------------------

export type TradeCondition = 'excellent' | 'good' | 'fair' | 'poor';
export interface TradeInputs {
  year: number;
  brand: string;
  condition: TradeCondition;
  electric: boolean;
  batteryYear?: number;
  lifted?: boolean;
}

const brandKey = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
const round50 = (n: number) => Math.round(n / 50) * 50;

/** Base value for a brand: settings key matched ignoring case/spaces/dashes ("EZGO" = "ez-go"), else _default. */
export function baseValueFor(brand: string, baseValues: Record<string, number>): number {
  const k = brandKey(brand);
  const hit = Object.entries(baseValues).find(([name]) => name !== '_default' && brandKey(name) === k);
  return Number(hit?.[1] ?? baseValues._default ?? 7000) || 0;
}

/**
 * base × (1 − yearlyDrop)^(age − 1) × condition; lifted +$400; electric with a battery older than 5 years −$800;
 * at least $500. Range ± rangePct, rounded to $50.
 */
export function tradeEstimate(t: TradeInputs, s: SalesSettings['tradeIn'], nowYear: number): {value: number; low: number; high: number; mid: number} {
  const age = Math.max(1, nowYear - t.year);
  const factor = Number(s.conditionFactor?.[t.condition] ?? 1) || 1;
  let v = baseValueFor(t.brand, s.baseValues || {}) * Math.pow(1 - (Number(s.yearlyDropPct) || 0) / 100, age - 1) * factor;
  if (t.lifted) v += 400;
  if (t.electric && t.batteryYear && nowYear - t.batteryYear > 5) v -= 800;
  v = Math.max(v, 500);
  const r = Math.min(Math.max(Number(s.rangePct) || 0, 0), 50) / 100;
  const low = Math.max(round50(v * (1 - r)), 0);
  const high = round50(v * (1 + r));
  return {value: Math.round(v), low, high, mid: round50((low + high) / 2)};
}

const MAX_PHOTO_BYTES = 2.5 * 1024 * 1024;
const MAX_PHOTOS = 6;
const IMAGE_EXT: Record<string, string> = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};

/** Decodes a "data:image/jpeg;base64,…" photo; checks the type, the file signature and the size. */
export function decodePhoto(v: unknown): {type: string; buf: Buffer} {
  const s = typeof v === 'string' ? v : v && typeof v === 'object' ? `data:${(v as Json).type};base64,${(v as Json).data}` : '';
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(s.slice(0, 4 * 1024 * 1024));
  if (!m) throw new PublicError(400, 'Photos must be JPEG, PNG or WebP pictures.');
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) throw new PublicError(400, 'One of the photos is too big (2.5 MB max).');
  const sig = m[1] === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff :
    m[1] === 'image/png' ? buf.subarray(0, 4).toString('hex') === '89504e47' :
      buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!sig) throw new PublicError(400, 'One of the photos could not be read. Please pick another picture.');
  return {type: m[1], buf};
}

/** Saves a photo to Storage with a download token; returns its public download URL. */
async function savePhoto(path: string, p: {type: string; buf: Buffer}): Promise<string> {
  const bucket = admin.storage().bucket();
  const token = randomUUID();
  await bucket.file(path).save(p.buf, {
    resumable: false, contentType: p.type,
    metadata: {cacheControl: 'public,max-age=31536000', metadata: {firebaseStorageDownloadTokens: token}},
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

// ---------------------------------------------------------------------------
// 9. Booking: slots (New York time, DST-safe) and capacity
// ---------------------------------------------------------------------------

const ACTIVE_APPT = new Set(['booked', 'showed']);
const pad2 = (n: number) => String(n).padStart(2, '0');
const toMin = (hhmm: string) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** Weekday of a New York date ("2026-10-08" → 'thu'). */
export const weekdayOf = (dateKey: string): WeekDay => nyParts(nyTime(dateKey, '12:00')).weekday;

/** The next `n` New York dates starting today. */
export function nextDays(now: number, n = 14): string[] {
  const noon = nyTime(nyDateKey(now), '12:00');
  return Array.from({length: n}, (_v, i) => nyDateKey(noon + i * DAY_MS));
}

/** Start times (ms) of every slot on a New York date, from the open hours; each slot ends by closing time. */
export function slotStarts(dateKey: string, b: SalesSettings['booking']): number[] {
  const h = b.hours?.[weekdayOf(dateKey)];
  if (!h) return [];
  const step = Math.min(Math.max(Math.round(Number(b.slotMinutes) || 30), 10), 240);
  const out: number[] = [];
  for (let m = toMin(h.open); m + step <= toMin(h.close); m += step) out.push(nyTime(dateKey, `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`));
  return out;
}

/** "2:30 PM" (New York). */
export const nyClock = (ts: number) => new Date(ts).toLocaleTimeString('en-US', {timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit'});

/** Slots that can still be booked: not in the next 30 minutes, and fewer than perSlot active bookings. */
export function openSlots(starts: number[], taken: Map<number, number>, perSlot: number, now: number): number[] {
  const cap = Math.max(1, Math.round(Number(perSlot) || 1));
  return starts.filter((t) => t > now + 30 * MIN_MS && (taken.get(t) || 0) < cap);
}

async function takenOn(storeId: string, dateKey: string): Promise<Map<number, number>> {
  const snap = await db().collection(C.appointments).where('storeId', '==', storeId).where('dateKey', '==', dateKey).get();
  const m = new Map<number, number>();
  for (const d of snap.docs) if (ACTIVE_APPT.has(String(d.get('status')))) m.set(Number(d.get('startAt')), (m.get(Number(d.get('startAt'))) || 0) + 1);
  return m;
}

const KIND_LABEL: Record<string, string> = {test_drive: 'test drive', visit: 'visit', delivery: 'delivery', service: 'service visit'};

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

const quoteCodeOf = (v: unknown) => {
  const s = str(v, 16).toLowerCase();
  if (!/^[a-z0-9]{6,16}$/.test(s)) throw new PublicError(404, 'We couldn\'t find that quote.');
  return s;
};
const storeInfo = (id: string) => {
  const st = storeOf(id);
  return st ? {id: st.id, name: st.name, city: storeCity(id), address: st.address, phone: st.phone} : null;
};
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Public (customer) view of a quote — no ids, uids or the customer's phone. */
function publicQuote(code: string, q: Json, now: number): Json {
  const rows = Array.isArray(q.rows) ? q.rows.slice(0, 40).map((r: Json) => ({
    lender: str(r.lender, 60), rateLabel: str(r.rateLabel, 60), term: num(r.term), payment: num(r.payment),
    totalOfPayments: num(r.totalOfPayments), note: str(r.note, 80),
  })) : [];
  const storeId = String(q.storeId || '');
  const book = `/book${storeIdOf(storeId) ? `/${storeId}` : ''}?${new URLSearchParams(clean({
    q: code, cart: q.cartId ? String(q.cartId) : undefined,
  }) as Record<string, string>).toString()}`;
  return {
    code, expired: !!q.expiresAt && Number(q.expiresAt) < now, cartTitle: str(q.cartTitle, 120), photo: httpsUrl(q.photo),
    videoUrl: httpsUrl(q.videoUrl), brand: str(q.brand, 60), cartPrice: num(q.cartPrice), accessories: num(q.accessories),
    prepFee: num(q.prepFee), deliveryFee: num(q.deliveryFee), deliveryTbc: q.deliveryTbc === true, militaryDiscount: num(q.militaryDiscount), salesTax: num(q.salesTax),
    otd: num(q.otd), downPayment: num(q.downPayment), tradeIn: num(q.tradeIn), loanAmount: num(q.loanAmount), rows,
    salespersonName: firstName(q.salespersonName), salespersonPhone: str(q.salespersonPhone, 30), store: storeInfo(storeId),
    customerFirst: q.customerName ? firstName(q.customerName) : '', createdAt: num(q.createdAt), expiresAt: num(q.expiresAt),
    interested: !!q.interestedAt, bookPath: book,
  };
}

const quoteHandlers: Record<string, PublicHandler> = {
  /** GET quote/get/<code>[?preview=1] — the first customer open notifies the salesperson and adds a call task. */
  get: async (req) => {
    const code = quoteCodeOf(req.rest[0] || req.query.code);
    const ref = db().collection(C.quotes).doc(code);
    const now = Date.now();
    const preview = req.query.preview === '1';
    const result = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return null;
      const q = s.data() || {};
      const first = !preview && !q.openedAt;
      if (!preview) tx.update(ref, clean({openCount: Number(q.openCount || 0) + 1, lastOpenedAt: now, openedAt: q.openedAt ? undefined : now}));
      return {q, first};
    });
    if (!result) throw new PublicError(404, 'We couldn\'t find that quote. Please call us and we\'ll send a new one.');
    const {q, first} = result;
    if (first) {
      const who = q.customerName ? firstName(q.customerName) : 'Your customer';
      const leadId = docIdOf(q.leadId);
      const sp = String(q.salespersonUid || '');
      await Promise.all([
        leadId ? db().collection(C.leads).doc(leadId).update({quoteOpenedAt: now, updatedAt: now}).catch(() => undefined) : null,
        sp ? notify(sp, 'Quote', `${who} just opened your quote${q.cartTitle ? ` for the ${q.cartTitle}` : ''}. Give them a call!`,
          {source: 'sales_closing', leadId, kind: 'quote_opened'}, `qo_${code}`) : null,
        sp ? db().collection(C.tasks).doc(`qo_${code}`).set(clean({
          ownerUid: sp, leadId: leadId || undefined, kind: 'quote_opened', title: `Call ${who} — they opened your quote`,
          channel: 'call', phone: q.customerPhone ? String(q.customerPhone) : undefined, dueAt: now, status: 'open', createdAt: now,
        }), {merge: true}) : null,
      ]);
    }
    return {body: publicQuote(code, q, now)};
  },

  /** POST quote/interested {code, preferredTime?, note?} */
  interested: async (req) => {
    const code = quoteCodeOf(req.body.code || req.rest[0]);
    const preferred = str(req.body.preferredTime, 100);
    const note = str(req.body.note, 300);
    const ref = db().collection(C.quotes).doc(code);
    const s = await ref.get();
    if (!s.exists) throw new PublicError(404, 'We couldn\'t find that quote.');
    const q = s.data() || {};
    const now = Date.now();
    if (q.expiresAt && Number(q.expiresAt) < now) throw new PublicError(410, 'This quote has expired. Please call us for an updated price.');
    const who = q.customerName ? String(q.customerName) : 'Your customer';
    const sp = String(q.salespersonUid || '');
    const text = `${firstName(who) === 'there' ? 'Your customer' : firstName(who)} is interested in ${q.cartTitle ? `the ${q.cartTitle}` : 'your quote'}!` +
      `${preferred ? ` Best time: ${preferred}.` : ''}${note ? ` "${note}"` : ''} Call them back.`;
    let leadId = docIdOf(q.leadId);
    const line = `Tapped "I'm interested" on quote ${code}${preferred ? ` (best time: ${preferred})` : ''}${note ? ` — ${note}` : ''}`;
    if (leadId) {
      const lead = await db().collection(C.leads).doc(leadId).get();
      if (lead.exists) {
        await lead.ref.update({quoteInterestedAt: now, notes: appendNote(lead.get('notes'), line), updatedAt: now});
      } else {
        leadId = '';
      }
    }
    if (!leadId && e164(q.customerPhone)) {
      const r = await attachOrCreateLead({
        name: str(q.customerName, 80) || 'Quote customer', phone: e164(q.customerPhone), source: 'quote', storeId: storeIdOf(q.storeId),
        ownerHint: sp, cartId: docIdOf(q.cartId) || undefined, cartTitle: str(q.cartTitle, 120), note: line,
        patch: {quoteCode: code, quoteSentAt: num(q.createdAt) || undefined, quoteOpenedAt: num(q.openedAt) || now, quoteInterestedAt: now},
        notifyText: text,
      });
      leadId = r.leadId;
    } else if (sp) {
      await notify(sp, 'Quote', text, {source: 'sales_closing', leadId, kind: 'quote_interested'}, `qi_${code}`);
    }
    await ref.update(clean({interestedAt: q.interestedAt || now, preferredTime: preferred || undefined, interestedNote: note || undefined, leadId: leadId || undefined}));
    if (sp) {
      await db().collection(C.tasks).doc(`qi_${code}`).set(clean({
        ownerUid: sp, leadId: leadId || undefined, kind: 'callback', title: `Call ${firstName(who)} — interested in your quote${preferred ? ` (best time: ${preferred})` : ''}`,
        channel: 'call', phone: q.customerPhone ? String(q.customerPhone) : undefined, dueAt: now, status: 'open', createdAt: now,
      }), {merge: true});
    }
    return {body: {ok: true}};
  },
};

const CREDIT_LABEL: Record<string, string> = {excellent: 'excellent (720+)', good: 'good (660–719)', fair: 'fair (600–659)', building: 'building (under 600)'};

const prequalHandlers: Record<string, PublicHandler> = {
  /** GET prequal/info?store= */
  info: async (req) => {
    const s = await loadSalesSettings();
    return {body: {enabled: s.prequal.enabled, intro: str(s.prequal.intro, 400), store: storeInfo(storeIdOf(req.query.store))}, cacheSeconds: 60};
  },
  /** POST prequal/submit {name, phone, email, creditRange, monthlyBudget, downPayment, consent, store, lead} */
  submit: async (req) => {
    const s = await loadSalesSettings();
    if (!s.prequal.enabled) throw new PublicError(403, 'Online pre-qualification is not available right now. Please call us.');
    const b = req.body;
    const name = reqName(b.name);
    const phone = reqPhone(b.phone);
    const email = optEmail(b.email);
    const creditRange = str(b.creditRange, 20);
    if (!CREDIT_LABEL[creditRange]) throw new PublicError(400, 'Please pick your credit range.');
    const monthlyBudget = dollars(b.monthlyBudget, 10000);
    const downPayment = dollars(b.downPayment, 100000);
    const consent = b.consent === true;
    const storeId = storeIdOf(b.store);
    const now = Date.now();
    const ref = db().collection(C.prequal).doc();
    await ref.set(clean({
      storeId: storeId || undefined, name, phone, email: email || undefined, creditRange, monthlyBudget: monthlyBudget || undefined,
      downPayment: downPayment || undefined, consent, status: 'started', createdAt: now, updatedAt: now,
    }));
    const r = await attachOrCreateLead({
      name, phone, email, source: 'prequal', storeId, leadId: docIdOf(b.lead) || undefined,
      note: `Pre-qualification: credit ${CREDIT_LABEL[creditRange]}${monthlyBudget ? `, budget ${money(monthlyBudget)}/mo` : ''}` +
        `${downPayment ? `, ${money(downPayment)} down` : ''}${consent ? ', OK to call/text' : ''}`,
      patch: clean({prequalId: ref.id, prequalStatus: 'started', smsConsent: consent ? true : undefined}),
      notifyText: `${name} started a pre-qualification — credit ${CREDIT_LABEL[creditRange]}` +
        `${monthlyBudget ? `, budget ${money(monthlyBudget)}/mo` : ''}. Phone ${prettyPhone(phone)}.`,
    });
    await ref.update({leadId: r.leadId, ownerUid: r.ownerUid});
    const lenders = (s.prequal.lenders || []).slice(0, 12).map((l) => ({name: str(l.name, 60), url: httpsUrl(l.url), note: str(l.note, 160)})).filter((l) => l.name);
    return {body: {ok: true, lenders, store: storeInfo(storeId)}};
  },
};

const CONDITIONS = new Set(['excellent', 'good', 'fair', 'poor']);

const tradeHandlers: Record<string, PublicHandler> = {
  /** GET trade/info?store= — brand list for the form. */
  info: async (req) => {
    const s = await loadSalesSettings();
    const brands = Object.keys(s.tradeIn.baseValues || {}).filter((k) => k !== '_default')
      .map((k) => k.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/^Ez-Go$/, 'EZ-GO'));
    return {body: {enabled: s.tradeIn.enabled, brands, store: storeInfo(storeIdOf(req.query.store))}, cacheSeconds: 60};
  },
  /** POST trade/submit {year, brand, model, electric, batteryYear, lifted, condition, notes, photos[], name, phone, email, store, lead} */
  submit: async (req) => {
    const s = await loadSalesSettings();
    if (!s.tradeIn.enabled) throw new PublicError(403, 'Online trade-in values are not available right now. Please call us.');
    const b = req.body;
    const nowYear = nyParts(Date.now()).year;
    const year = Math.round(Number(b.year));
    if (!Number.isFinite(year) || year < 1980 || year > nowYear + 1) throw new PublicError(400, 'Please pick the cart\'s year.');
    const brand = str(b.brand, 40);
    if (!brand) throw new PublicError(400, 'Please enter the brand.');
    const model = str(b.model, 60);
    const condition = str(b.condition, 12) as TradeCondition;
    if (!CONDITIONS.has(condition)) throw new PublicError(400, 'Please pick the condition.');
    const electric = b.electric !== false;
    const by = Math.round(Number(b.batteryYear));
    const batteryYear = electric && Number.isFinite(by) && by >= 1990 && by <= nowYear + 1 ? by : undefined;
    const lifted = b.lifted === true;
    const notes = str(b.notes, 500);
    const name = reqName(b.name);
    const phone = reqPhone(b.phone);
    const email = optEmail(b.email);
    const storeId = storeIdOf(b.store);
    const rawPhotos = Array.isArray(b.photos) ? b.photos : [];
    if (rawPhotos.length > MAX_PHOTOS) throw new PublicError(400, `Up to ${MAX_PHOTOS} photos, please.`);
    const photos = rawPhotos.map(decodePhoto);
    const est = tradeEstimate({year, brand, condition, electric, batteryYear, lifted}, s.tradeIn, nowYear);
    const now = Date.now();
    const ref = db().collection(C.tradeIns).doc();
    const urls: string[] = [];
    for (let n = 0; n < photos.length; n++) {
      try {
        urls.push(await savePhoto(`${C.tradeIns}/${ref.id}/${n + 1}.${IMAGE_EXT[photos[n].type]}`, photos[n]));
      } catch (e) {
        logger.error('trade-in photo upload failed', ref.id, n, e);
      }
    }
    await ref.set(clean({
      storeId: storeId || undefined, name, phone, email: email || undefined, year, brand, model, condition, electric, batteryYear,
      lifted, notes: notes || undefined, photos: urls, estimateLow: est.low, estimateHigh: est.high, status: 'new', createdAt: now, updatedAt: now,
    }));
    const title = [year, brand, model].filter(Boolean).join(' ');
    const r = await attachOrCreateLead({
      name, phone, email, source: 'trade_in', storeId, leadId: docIdOf(b.lead) || undefined,
      note: `Trade-in: ${title} (${condition}${lifted ? ', lifted' : ''}${electric ? `, electric${batteryYear ? `, battery ${batteryYear}` : ''}` : ', gas'}) — estimate ${money(est.low)}–${money(est.high)}`,
      patch: {hasTrade: true, tradeInId: ref.id, tradeValue: est.mid},
      notifyText: `${name} sent a trade-in: ${title}, ${condition}. Estimate ${money(est.low)}–${money(est.high)}${urls.length ? `, ${urls.length} photo${urls.length > 1 ? 's' : ''}` : ''}. Phone ${prettyPhone(phone)}.`,
    });
    await ref.update({leadId: r.leadId, ownerUid: r.ownerUid});
    return {body: {ok: true, low: est.low, high: est.high, photos: urls.length, store: storeInfo(storeId)}};
  },
};

const bookingHandlers: Record<string, PublicHandler> = {
  /** GET booking/info?store=&cart= — stores, the next 14 days, the cart title. */
  info: async (req) => {
    const s = await loadSalesSettings();
    const now = Date.now();
    const cartId = docIdOf(req.query.cart);
    let cart: Json | null = null;
    if (cartId) {
      const c = await db().collection(C.carts).doc(cartId).get();
      if (c.exists && c.get('soldLocally') !== true) {
        const sum = cartSummary(c.data() || {});
        cart = {id: cartId, title: sum.title, storeId: storeIdOf(sum.locationId)};
      }
    }
    const days = nextDays(now).map((d) => ({date: d, weekday: weekdayOf(d), closed: !s.booking.hours?.[weekdayOf(d)]}));
    const stores = STORES.filter((x) => x.id !== 'T0').map((x) => storeInfo(x.id));
    return {body: {enabled: s.booking.enabled, stores, days, cart, store: storeInfo(storeIdOf(req.query.store))}, cacheSeconds: 30};
  },
  /** GET booking/slots?store=&date= — open start times. */
  slots: async (req) => {
    const s = await loadSalesSettings();
    const storeId = storeIdOf(req.query.store);
    if (!storeId) throw new PublicError(400, 'Please pick a store.');
    const now = Date.now();
    const date = str(req.query.date, 10);
    if (!nextDays(now).includes(date)) throw new PublicError(400, 'Please pick a day in the next two weeks.');
    const starts = slotStarts(date, s.booking);
    const open = starts.length ? openSlots(starts, await takenOn(storeId, date), s.booking.perSlot, now) : [];
    return {body: {date, closed: !starts.length, slots: open.map((t) => ({start: t, label: nyClock(t)}))}};
  },
  /** POST booking/book {store, date, start, kind, name, phone, email, cart, lead, q, notes} — capacity re-checked in a transaction. */
  book: async (req) => {
    const s = await loadSalesSettings();
    if (!s.booking.enabled) throw new PublicError(403, 'Online booking is not available right now. Please call us.');
    const b = req.body;
    const storeId = storeIdOf(b.store);
    if (!storeId) throw new PublicError(400, 'Please pick a store.');
    const now = Date.now();
    const date = str(b.date, 10);
    if (!nextDays(now).includes(date)) throw new PublicError(400, 'Please pick a day in the next two weeks.');
    const start = Number(b.start);
    const starts = slotStarts(date, s.booking);
    if (!starts.includes(start) || start <= now + 30 * MIN_MS) throw new PublicError(400, 'That time is not available. Please pick another time.');
    const kind = b.kind === 'visit' ? 'visit' : 'test_drive';
    const name = reqName(b.name);
    const phone = reqPhone(b.phone);
    const email = optEmail(b.email);
    const notes = str(b.notes, 300);
    let cartId = docIdOf(b.cart);
    let cartTitle = '';
    if (cartId) {
      const c = await db().collection(C.carts).doc(cartId).get();
      if (c.exists) cartTitle = cartSummary(c.data() || {}).title;
      else cartId = '';
    }
    // A booking from a quote link attaches to that quote's lead and salesperson.
    let leadHint = docIdOf(b.lead);
    let ownerHint = '';
    const qc = str(b.q, 16).toLowerCase();
    if (/^[a-z0-9]{6,16}$/.test(qc)) {
      const q = await db().collection(C.quotes).doc(qc).get();
      if (q.exists) {
        leadHint = leadHint || docIdOf(q.get('leadId'));
        ownerHint = String(q.get('salespersonUid') || '');
      }
    }
    const step = Math.min(Math.max(Math.round(Number(s.booking.slotMinutes) || 30), 10), 240);
    const cap = Math.max(1, Math.round(Number(s.booking.perSlot) || 1));
    const apptRef = db().collection(C.appointments).doc();
    const lockRef = db().collection(C.meta).doc(`book_${storeId}_${start}`);
    const apptId = await db().runTransaction(async (tx) => {
      await tx.get(lockRef); // every booking for this slot touches the lock → concurrent bookings conflict and retry
      const same = await tx.get(db().collection(C.appointments).where('storeId', '==', storeId).where('startAt', '==', start));
      const active = same.docs.filter((d) => ACTIVE_APPT.has(String(d.get('status'))));
      const mine = active.find((d) => e164(d.get('phone')) === phone);
      if (mine) return mine.id; // pressed "Book" twice
      if (active.length >= cap) throw new PublicError(409, 'Sorry, that time just filled up. Please pick another time.');
      tx.set(lockRef, {count: active.length + 1, at: now, expireAt: start + DAY_MS});
      tx.set(apptRef, clean({
        storeId, name, phone, email: email || undefined, kind, cartId: cartId || undefined, cartTitle: cartTitle || undefined,
        startAt: start, endAt: start + step * MIN_MS, dateKey: date, status: 'booked', source: 'public', notes: notes || undefined,
        createdAt: now, updatedAt: now,
      }));
      return apptRef.id;
    });
    const when = nyWhen(start);
    const city = storeCity(storeId);
    if (apptId === apptRef.id) {
      const people = await loadPeople();
      const r = await attachOrCreateLead({
        name, phone, email, source: 'booking', storeId, leadId: leadHint || undefined, ownerHint: ownerHint || undefined,
        cartId: cartId || undefined, cartTitle, note: `Booked a ${KIND_LABEL[kind]} for ${when} at ${city}${cartTitle ? ` (${cartTitle})` : ''}${notes ? ` — ${notes}` : ''}`,
        patch: {appointmentId: apptRef.id, appointmentAt: start},
        notifyText: `New ${KIND_LABEL[kind]} booked: ${name}, ${when} at ${city}${cartTitle ? ` — ${cartTitle}` : ''}. Phone ${prettyPhone(phone)}.`,
        alsoNotify: managersFor(people, storeId).filter((p) => p.location === storeId).map((p) => p.uid),
      });
      await apptRef.update({leadId: r.leadId, ownerUid: r.ownerUid});
    }
    return {body: {ok: true, when, kind, store: storeInfo(storeId), cartTitle}};
  },
};

/** area → action → handler. Areas: quote, booking, trade, prequal. */
export const closingPublic: Record<string, Record<string, PublicHandler>> = {
  quote: quoteHandlers,
  booking: bookingHandlers,
  trade: tradeHandlers,
  prequal: prequalHandlers,
};

// ---------------------------------------------------------------------------
// Every 5 minutes: reminders, "did they show up?", no-show follow-up
// ---------------------------------------------------------------------------

/** When the day-before reminder goes out: 10am New York the day before (only for bookings made > 24 h ahead). */
export function dayBeforeAt(a: {startAt: number; createdAt: number}): number | null {
  if (a.startAt - a.createdAt <= DAY_MS) return null;
  const prev = nyDateKey(nyTime(nyDateKey(a.startAt), '12:00') - DAY_MS);
  return nyTime(prev, '10:00');
}

export async function appointmentTick(now: number, s: SalesSettings): Promise<void> {
  const col = db().collection(C.appointments);
  const [booked, noShows] = await Promise.all([col.where('status', '==', 'booked').get(), col.where('status', '==', 'no_show').get()]);
  let people: Person[] | null = null;
  const nameOf = async (uid: string) => {
    people = people || await loadPeople();
    return people.find((p) => p.uid === uid)?.name || '';
  };
  const textData = async (a: Json, extra: Json) =>
    leadTemplateData({name: a.name, locationId: a.storeId, cartTitle: a.cartTitle}, await nameOf(String(a.ownerUid || '')), extra);

  for (const d of booked.docs) {
    const a = d.data();
    const startAt = Number(a.startAt) || 0;
    const endAt = Number(a.endAt) || startAt + 30 * MIN_MS;
    const createdAt = Number(a.createdAt) || 0;
    if (!startAt || startAt < now - 3 * DAY_MS || startAt > now + 2 * DAY_MS) continue;
    const patch: Json = {};
    try {
      // Day before, ~10am New York.
      if (!a.remindedDayBefore) {
        const at = dayBeforeAt({startAt, createdAt});
        if (at === null || now >= startAt - 3 * HOUR_MS) patch.remindedDayBefore = true; // too late / booked recently: skip
        else if (now >= at) {
          await queueSms({
            to: a.phone, kind: 'appointment', storeId: a.storeId, leadId: a.leadId, appointmentId: d.id, dedupeKey: `appt_day_${d.id}`,
            body: fill(s.booking.reminderTemplate, await textData(a, {when: nyWhen(startAt), link: bookUrl(a.storeId)})),
          });
          patch.remindedDayBefore = true;
        }
      }
      // 2 hours before (not for bookings made in the last 2 hours before the visit).
      if (!a.remindedSoon && now >= startAt - 2 * HOUR_MS) {
        if (now < startAt && createdAt < startAt - 2 * HOUR_MS) {
          await queueSms({
            to: a.phone, kind: 'appointment', storeId: a.storeId, leadId: a.leadId, appointmentId: d.id, dedupeKey: `appt_soon_${d.id}`,
            body: fill(s.booking.reminderTemplate, await textData(a, {when: `today at ${nyClock(startAt)}`, link: bookUrl(a.storeId)})),
          });
        }
        patch.remindedSoon = true;
      }
      // Ended over an hour ago and nobody marked it: ask the owner.
      if (!a.showAskedAt && now > endAt + HOUR_MS) {
        const who = String(a.ownerUid || '') || managersFor(people || await loadPeople(), a.storeId)[0]?.uid || '';
        if (who) {
          await notify(who, 'Appointments', `Did ${a.name || 'your customer'} show up for the ${KIND_LABEL[a.kind] || 'visit'} at ${nyClock(startAt)}? Mark it in Appointments.`,
            {source: 'sales_closing', kind: 'appointment_check', appointmentId: d.id, leadId: a.leadId || ''}, `appt_show_${d.id}`);
        }
        patch.showAskedAt = now;
      }
      if (Object.keys(patch).length) await d.ref.update({...patch, updatedAt: now});
    } catch (e) {
      logger.error('appointmentTick: booked', d.id, e);
    }
  }

  for (const d of noShows.docs) {
    const a = d.data();
    if (a.noShowTextedAt || Number(a.startAt) < now - 7 * DAY_MS) continue;
    try {
      await queueSms({
        to: a.phone, kind: 'no_show', storeId: a.storeId, leadId: a.leadId, appointmentId: d.id, dedupeKey: `appt_noshow_${d.id}`,
        body: fill(s.booking.noShowTemplate, await textData(a, {when: nyWhen(Number(a.startAt)), link: bookUrl(a.storeId, a.leadId)})),
      });
      await d.ref.update({noShowTextedAt: now, updatedAt: now});
    } catch (e) {
      logger.error('appointmentTick: no-show', d.id, e);
    }
  }
}

/** Public booking link (same as the client's bookUrl). */
export const bookUrl = (storeId?: string, leadId?: string) =>
  `${PUBLIC_ORIGIN}/book${storeIdOf(storeId) ? `/${storeId}` : ''}${leadId ? `?lead=${encodeURIComponent(String(leadId))}` : ''}`;
