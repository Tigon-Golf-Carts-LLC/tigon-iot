// Cart pricing & financing calculator — the math from "Cart Pricing & Financing Calculator: Calculation Spec"
// (mirrors 001_Financing_Grids_NEW.xlsx). Pure functions, no React / Firebase.

export type Brand = 'evolution' | 'tara' | 'icon' | 'teko' | 'denago' | 'other';
export type Condition = 'new' | 'used';
export type EvoModel = 'other' | 'dmax';
export type Tier = 'A' | 'B' | 'C' | 'D' | 'E';
export type LenderId = 'sheffield' | 'dd' | 'ddnf' | 'dll';

export const BRANDS: Array<{ id: Brand; label: string }> = [
  { id: 'evolution', label: 'Evolution' },
  { id: 'tara', label: 'Tara' },
  { id: 'icon', label: 'Icon & Epic' },
  { id: 'teko', label: 'Teko' },
  { id: 'denago', label: 'Denago' },
  { id: 'other', label: 'Other brands & used' },
];
export const brandLabel = (b: Brand) => BRANDS.find((x) => x.id === b)?.label || b;

export const LENDER_LABEL: Record<LenderId, string> = {
  sheffield: 'Sheffield Financial',
  dd: 'Dealer Direct',
  ddnf: 'Dealer Direct No Frills',
  dll: 'DLL Financing',
};

/** Picks the calculator brand from a cart's make. */
export function brandFromMake(make: string | undefined, isUsed?: boolean): Brand {
  const m = (make || '').toLowerCase();
  if (isUsed) return 'other';
  if (m.includes('evolution')) return 'evolution';
  if (m.includes('tara')) return 'tara';
  if (m.includes('icon') || m.includes('epic')) return 'icon';
  if (m.includes('teko')) return 'teko';
  if (m.includes('denago')) return 'denago';
  return 'other';
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// 2. Out-the-door price
// ---------------------------------------------------------------------------

export const MILITARY_DISCOUNT = 200;

/** 2.2 Dealer prep fee. */
export function prepFeeFor(condition: Condition, brand: Brand, evoModel: EvoModel): number {
  if (condition === 'used') return 0;
  if (brand === 'evolution' && evoModel === 'dmax') return 975;
  return 600;
}

/** 2.3 Delivery fee: $100 + $50 per billed half hour (:15 and :45 round up); under 20 min = $100; no time = $0. */
export function deliveryFee(driveMinutes: number | null | undefined): { fee: number; billedHalfHours: number; explain: string } {
  if (!driveMinutes || driveMinutes <= 0) return { fee: 0, billedHalfHours: 0, explain: '' };
  if (driveMinutes < 20) return { fee: 100, billedHalfHours: 0, explain: 'Under 20 min: flat $100' };
  const h = Math.floor((driveMinutes + 15) / 30);
  const fee = 100 + 50 * h;
  return { fee, billedHalfHours: h, explain: `Billed as ${fmtDuration(h * 30)}: $100 + ${h} × $50 = $${fee}` };
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** 2.4 Drive-time estimate from straight-line distance. */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function estimateDriveMinutes(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const crow = haversineMiles(a, b);
  const road = Math.max(crow * (1.2 + 0.15 * Math.exp(-crow / 100)), 1);
  const mph = 30 + 33 * (1 - Math.exp(-road / 60));
  return Math.round((road / mph) * 60 + 3);
}

/**
 * Statewide sales tax rates for every other state (decimal). Many states add county / city tax on top
 * (LOCAL_TAX_STATES) — the calculator fills the state rate and tells the salesperson to add the local part.
 */
const STATE_TAX: Record<string, number> = {
  AL: 0.04, AK: 0, AZ: 0.056, AR: 0.065, CA: 0.0725, CO: 0.029, CT: 0.0635, DC: 0.06, FL: 0.06, GA: 0.04, HI: 0.04,
  ID: 0.06, IL: 0.0625, IN: 0.07, IA: 0.06, KS: 0.065, KY: 0.06, LA: 0.05, ME: 0.055, MA: 0.0625, MI: 0.06, MN: 0.06875,
  MS: 0.07, MO: 0.04225, MT: 0, NE: 0.055, NV: 0.0685, NH: 0, NM: 0.04875, NY: 0.04, NC: 0.0475, ND: 0.05, OH: 0.0575,
  OK: 0.045, OR: 0, RI: 0.07, SC: 0.06, SD: 0.042, TN: 0.07, TX: 0.0625, UT: 0.061, VT: 0.06, VA: 0.053, WA: 0.065,
  WV: 0.06, WI: 0.05, WY: 0.04,
};
/** States where counties / cities usually add their own sales tax on top of the state rate. */
const LOCAL_TAX_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'FL', 'GA', 'HI', 'ID', 'IL', 'IA', 'KS', 'LA', 'MN', 'MS', 'MO', 'NE', 'NV', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

/** 2.5 Sales tax by state / county. null = unknown (salesperson types it). */
export function taxRateFor(state: string | undefined, county: string | undefined): number | null {
  const st = (state || '').toUpperCase();
  const c = (county || '').toLowerCase();
  if (st === 'PA') return c.includes('philadelphia') ? 0.08 : c.includes('allegheny') ? 0.07 : 0.06;
  if (st === 'NJ') return 0.06625;
  if (st === 'DE') return 0;
  if (st === 'MD') return 0.06;
  return st in STATE_TAX ? STATE_TAX[st] : null;
}

/** True when the rate from taxRateFor is the state rate only and a county / city tax may apply on top. */
export const localTaxMayApply = (state: string | undefined) => LOCAL_TAX_STATES.has((state || '').toUpperCase());

export interface OtdInput {
  cartPrice: number;
  accessories: number;
  prepFee: number;
  deliveryFee: number;
  military: boolean;
  taxRate: number;
  downPayment: number;
}
export interface Otd { taxable: number; salesTax: number; otd: number; loanAmount: number; militaryDiscount: number }

/** 2.6 OTD formula. */
export function computeOtd(i: OtdInput): Otd {
  const militaryDiscount = i.military ? MILITARY_DISCOUNT : 0;
  const taxable = Math.max((i.cartPrice || 0) + (i.accessories || 0) + (i.prepFee || 0) + (i.deliveryFee || 0) - militaryDiscount, 0);
  const salesTax = round2(taxable * (i.taxRate || 0));
  const otd = round2(taxable + salesTax);
  return { taxable: round2(taxable), salesTax, otd, loanAmount: round2(otd - (i.downPayment || 0)), militaryDiscount };
}

// ---------------------------------------------------------------------------
// 3. Financing math
// ---------------------------------------------------------------------------

/** 3.2 Excel PMT(rate/12, term, -amount). */
export function pmt(amount: number, annualRate: number, term: number): number {
  if (annualRate === 0) return round2(amount / term);
  const r = annualRate / 12;
  return round2((amount * r) / (1 - (1 + r) ** -term));
}

/** 3.3 "6 months no interest, then X%": one level payment. */
export function pmtSixFree(amount: number, annualRate: number, term: number): number {
  const n = term - 6;
  const r = annualRate / 12;
  const k = r === 0 ? 1 / n : r / (1 - (1 + r) ** -n);
  return round2((amount * k) / (1 + 6 * k));
}

export interface FinanceOption {
  id: string;
  lender: LenderId;
  /** Annual rate as a decimal (0.0849). */
  rate: number;
  term: number;
  /** Program fee % as a decimal (0.065); 0 = none. */
  feePct: number;
  orig: number;
  sixFree?: boolean;
  /** Sheffield standard grid row. */
  tier?: Tier;
  /** Promo eligibility label, e.g. "A, B & C". */
  tiers?: string;
  /** Cart restriction shown as "Good to know". */
  note?: string;
  newOnly?: boolean;
  minLoan?: number;
  maxLoan?: number;
}

export interface Quote {
  option: FinanceOption;
  programFee: number;
  amountFinanced: number;
  payment: number;
  totalOfPayments: number;
  totalFeesAndInterest: number;
  /** Why it can't be used ('' = available). */
  unavailable: string;
}

export function quote(o: FinanceOption, loanAmount: number, condition: Condition): Quote {
  const programFee = o.feePct > 0 ? loanAmount * o.feePct + 10 : 0;
  const amountFinanced = loanAmount + programFee + o.orig;
  const payment = o.sixFree ? pmtSixFree(amountFinanced, o.rate, o.term) : pmt(amountFinanced, o.rate, o.term);
  const totalOfPayments = round2(payment * o.term);
  let unavailable = '';
  if ((o.minLoan !== undefined && loanAmount < o.minLoan) || (o.maxLoan !== undefined && loanAmount > o.maxLoan)) unavailable = 'Not available for this loan amount';
  else if (o.newOnly && condition === 'used') unavailable = 'New carts only';
  return {
    option: o, programFee: round2(programFee), amountFinanced: round2(amountFinanced), payment, totalOfPayments,
    totalFeesAndInterest: round2(totalOfPayments - loanAmount), unavailable,
  };
}

export const rateLabel = (o: FinanceOption) => {
  const pct = `${+(o.rate * 100).toFixed(3)}%`;
  return o.sixFree ? `6 months no interest, then ${pct}` : pct;
};

// ---------------------------------------------------------------------------
// 4. Rate tables
// ---------------------------------------------------------------------------

const TIER_GRID: Record<Tier, [number, number, number]> = {
  A: [0.0849, 0.0899, 0.0949],
  B: [0.0949, 0.1099, 0.1149],
  C: [0.1249, 0.1299, 0.1349],
  D: [0.1449, 0.1499, 0.1549],
  E: [0.1549, 0.1574, 0.1599],
};
export const TIERS: Tier[] = ['A', 'B', 'C', 'D', 'E'];
const GRID_TERMS = [36, 48, 60];

let seq = 0;
const opt = (o: Omit<FinanceOption, 'id'>): FinanceOption => ({ ...o, id: `${o.lender}-${o.term}-${o.rate}-${o.feePct}-${o.tier || ''}-${o.sixFree ? 'six' : ''}-${o.minLoan ?? ''}-${seq++}` });

function grid(orig: number): FinanceOption[] {
  const out: FinanceOption[] = [];
  for (const t of TIERS) GRID_TERMS.forEach((term, i) => out.push(opt({ lender: 'sheffield', rate: TIER_GRID[t][i], term, feePct: 0, orig, tier: t })));
  return out;
}
const dll = () => [24, 36, 48, 60].map((term) => opt({ lender: 'dll', rate: 0.075, term, feePct: 0, orig: 125 }));
const sh = (rate: number, term: number, feePct: number, tiers: string, extra: Partial<FinanceOption> = {}) =>
  opt({ lender: 'sheffield', rate, term, feePct, orig: 150, tiers, ...extra });
const dd = (rate: number, term: number, feePct: number, extra: Partial<FinanceOption> = {}) =>
  opt({ lender: 'dd', rate, term, feePct, orig: 125, note: 'New carts only', newOnly: true, ...extra });

export interface BrandProgram {
  promos: FinanceOption[];
  grid: FinanceOption[];
  dealerDirect: FinanceOption[];
  noFrills: FinanceOption[];
  dll: FinanceOption[];
  roadrunner: string;
}

const RR_EVO = 'Roadrunner Financial: rates 9.99% to 22.99% up to 84 months for Evolution; 10.74% to 22.99% up to 72 months for other brands. Approvals start at a 550 credit score; soft-pull application available.';

export const PROGRAMS: Record<Brand, BrandProgram> = {
  evolution: {
    promos: [sh(0, 36, 0.065, 'A, B & C'), sh(0.0599, 36, 0.05, 'A & B')],
    grid: grid(150),
    dealerDirect: [dd(0, 24, 0.0675), dd(0, 30, 0.08), dd(0, 36, 0.10), dd(0.0699, 60, 0.035)],
    noFrills: [],
    dll: dll(),
    roadrunner: RR_EVO,
  },
  tara: {
    promos: [sh(0.0999, 48, 0.04, 'A & B', { sixFree: true }), sh(0.0599, 36, 0.05, 'A & B')],
    grid: grid(150),
    dealerDirect: [],
    noFrills: [],
    dll: dll(),
    roadrunner: '',
  },
  icon: {
    promos: [sh(0, 24, 0.08, 'A, B & C', { note: '2020 & newer carts' }), sh(0, 36, 0.08, 'A, B & C', { note: '2020 & newer carts' })],
    grid: [],
    dealerDirect: [dd(0, 24, 0.025), dd(0, 36, 0.0625), dd(0.0199, 36, 0.04), dd(0.0299, 48, 0.05)],
    noFrills: [],
    dll: dll(),
    roadrunner: '',
  },
  teko: {
    promos: [
      sh(0, 24, 0.06, 'A & B'), sh(0, 36, 0.0525, 'A, B & C'), sh(0, 48, 0.06, 'A, B & C'), sh(0.0299, 48, 0.0525, 'A, B & C'),
      sh(0.0599, 36, 0.04, 'A & B', { sixFree: true }),
    ],
    grid: grid(150),
    dealerDirect: [dd(0, 24, 0.04), dd(0, 36, 0.065), dd(0, 48, 0.06), dd(0.0299, 48, 0.0575), dd(0.0599, 60, 0.02)],
    noFrills: [],
    dll: dll(),
    roadrunner: 'Roadrunner Financial: rates starting at 8.49%. Approvals start at a 550 credit score; soft-pull application available.',
  },
  denago: {
    promos: [
      sh(0, 24, 0.06, 'A & B'), sh(0, 36, 0.055, 'A, B & C'), sh(0, 48, 0.06, 'A, B & C'), sh(0.0399, 48, 0.0575, 'A, B & C'),
      sh(0.0599, 36, 0.045, 'A & B'),
    ],
    grid: grid(150),
    dealerDirect: [dd(0, 24, 0.0375), dd(0, 36, 0.0575), dd(0, 48, 0.06), dd(0.0299, 48, 0.0525), dd(0.0599, 60, 0.0175)],
    noFrills: [],
    dll: dll(),
    roadrunner: RR_EVO,
  },
  other: {
    promos: [
      sh(0.0599, 36, 0.05, 'A & B', { orig: 125, note: '2015 & newer carts' }),
      sh(0.0999, 48, 0.045, 'A & B', { orig: 125, sixFree: true, note: '2015 & newer carts' }),
    ],
    grid: grid(125).map((o) => ({ ...o, note: '2015 & newer carts' })),
    dealerDirect: [
      dd(0.0299, 60, 0.10, { note: '2021 & newer carts', newOnly: false }), dd(0.0329, 36, 0.0625, { note: '2021 & newer carts', newOnly: false }),
      dd(0.0599, 36, 0.0375, { note: '2021 & newer carts', newOnly: false }), dd(0.0599, 48, 0.04, { note: '2021 & newer carts', newOnly: false }),
      dd(0.0749, 60, 0.03, { note: '2021 & newer carts', newOnly: false }),
    ],
    noFrills: [
      opt({ lender: 'ddnf', rate: 0.0279, term: 18, feePct: 0, orig: 125, minLoan: 1500, maxLoan: 3500 }),
      ...[36, 48, 60].map((term) => opt({ lender: 'ddnf', rate: 0.0879, term, feePct: 0, orig: 125, minLoan: 3000, maxLoan: 30000 })),
      opt({ lender: 'ddnf', rate: 0.0899, term: 72, feePct: 0, orig: 125, minLoan: 20000.01, maxLoan: 50000 }),
    ],
    dll: dll(),
    roadrunner: `${RR_EVO} For 2016 and newer carts.`,
  },
};

/** Every term that appears for a brand (for the term filter). */
export function termsFor(brand: Brand): number[] {
  const p = PROGRAMS[brand];
  return Array.from(new Set([...p.promos, ...p.grid, ...p.dealerDirect, ...p.noFrills, ...p.dll].map((o) => o.term))).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 5. Calculator view + 6. customer sheet
// ---------------------------------------------------------------------------

export interface Results {
  loanAmount: number;
  promos: Quote[];
  /** Standard grid, all tiers (the page shows Tier A unless "Show Tiers B to E"). */
  grid: Quote[];
  dealerDirect: Quote[];
  noFrills: Quote[];
  dll: Quote[];
  roadrunner: string;
  lowestPayment?: Quote;
  lowestCost?: Quote;
}

export function buildResults(brand: Brand, loanAmount: number, condition: Condition, termFilter: number | 'all'): Results {
  const p = PROGRAMS[brand];
  const keep = (o: FinanceOption) => termFilter === 'all' || o.term === termFilter;
  const q = (list: FinanceOption[]) => list.filter(keep).map((o) => quote(o, loanAmount, condition));
  const r: Results = {
    loanAmount, promos: q(p.promos), grid: q(p.grid), dealerDirect: q(p.dealerDirect), noFrills: q(p.noFrills), dll: q(p.dll),
    roadrunner: termFilter === 'all' ? p.roadrunner : '',
  };
  const eligible = allEligible(r);
  r.lowestPayment = eligible.reduce<Quote | undefined>((best, x) => (!best || x.payment < best.payment ? x : best), undefined);
  r.lowestCost = eligible.reduce<Quote | undefined>((best, x) => (!best || x.totalFeesAndInterest < best.totalFeesAndInterest ? x : best), undefined);
  return r;
}

/** Usable options with the standard grid at Tier A only. */
export function allEligible(r: Results): Quote[] {
  return [...r.promos, ...r.grid.filter((x) => x.option.tier === 'A'), ...r.dealerDirect, ...r.noFrills, ...r.dll].filter((x) => !x.unavailable);
}

/** 6.1 Which options appear on the customer sheet. */
export function customerSheetRows(r: Results): Quote[] {
  const eligible = allEligible(r);
  const lenderGroup = (l: LenderId) => (l === 'ddnf' ? 'dd' : l);
  const best = new Map<string, Quote>();
  for (const x of eligible) {
    const k = `${lenderGroup(x.option.lender)}|${x.option.term}`;
    const cur = best.get(k);
    if (!cur || x.payment < cur.payment) best.set(k, x);
  }
  const keep = new Set<Quote>(best.values());
  for (const x of eligible) if (x.option.rate === 0 && !x.option.sixFree) keep.add(x);
  return Array.from(keep).sort((a, b) => a.option.term - b.option.term || a.payment - b.payment);
}
