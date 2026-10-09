// "Sell more" release — shared types for the 20 sales features. Every track builds against these;
// change them only in coordination. Server mirror: functions/src/sales/settings.ts + outbox.ts.

export const SALES_COLLECTIONS = {
  sms: 'mp_sms',
  smsOptOut: 'mp_sms_optout',
  smsInbound: 'mp_sms_inbound',
  tasks: 'mp_tasks',
  quotes: 'mp_quotes',
  appointments: 'mp_appointments',
  tradeIns: 'mp_trade_ins',
  prequal: 'mp_prequal',
  referrals: 'mp_referrals',
  priceChanges: 'mp_price_changes',
  reviews: 'mp_reviews',
} as const;

// ---------------------------------------------------------------------------
// Settings (mp_settings/sales)
// ---------------------------------------------------------------------------

export type WeekDay = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export type DayHours = { open: string; close: string } | null;
export interface CadenceStep { day: number; channel: 'sms' | 'call' | 'email'; template: string }
export interface ServiceStep { months: number; kind: 'battery' | 'accessories' | 'upgrade' | 'checkup'; template: string }
export interface LenderLink { name: string; url: string; note?: string }

export interface SalesSettings {
  speed: { enabled: boolean; alertMinutes: number[]; notifyManagers: boolean };
  assignment: { mode: 'off' | 'round_robin'; claimMinutes: number; onlineOnly: boolean };
  dailyList: { enabled: boolean; hour: number };
  fbLeads: { enabled: boolean };
  sms: {
    provider: 'phone' | 'twilio';
    senderDeviceByStore: Record<string, string>;
    defaultSenderDeviceId: string;
    twilioFromByStore: Record<string, string>;
    twilioDefaultFrom: string;
    quietStart: number;
    quietEnd: number;
  };
  autoText: { enabled: boolean; template: string; channels: string[] };
  missedCall: { enabled: boolean; template: string; createLead: boolean };
  cadence: { enabled: boolean; steps: CadenceStep[] };
  service: { enabled: boolean; steps: ServiceStep[] };
  prequal: { enabled: boolean; lenders: LenderLink[]; intro: string };
  quotes: { enabled: boolean; expireDays: number };
  tradeIn: {
    enabled: boolean;
    baseValues: Record<string, number>;
    yearlyDropPct: number;
    conditionFactor: { excellent: number; good: number; fair: number; poor: number };
    rangePct: number;
  };
  booking: {
    enabled: boolean;
    slotMinutes: number;
    hours: Record<WeekDay, DayHours>;
    perSlot: number;
    reminderTemplate: string;
    noShowTemplate: string;
  };
  priceDrop: { enabled: boolean; minDropPct: number; template: string };
  aged: { flagDays: number; urgentDays: number; suggestedCutPct: number };
  soldSimilar: { enabled: boolean; template: string };
  reviews: { enabled: boolean; placeIds: Record<string, string>; alertAtOrBelow: number };
  referral: { enabled: boolean; rewardAmount: number; template: string };
}

// ---------------------------------------------------------------------------
// Lead fields added by this release (stored on mp_leads; all optional)
// ---------------------------------------------------------------------------

export interface LeadSalesFields {
  /** Store the lead belongs to (DEALERSHIPS id). */
  locationId?: string;
  /** Where it came from in more detail: 'website' | 'facebook_message' | 'missed_call' | 'quote' | 'booking' | 'trade_in' | 'prequal' | 'referral' | … */
  source?: string;
  /** T1 — first human reply (call/text/claim) and minutes it took. */
  firstResponseAt?: number;
  responseMinutes?: number;
  /** T1 — speed alerts already sent (minutes marks). */
  speedAlerted?: number[];
  /** T1 — round robin. */
  assignedAt?: number;
  claimDeadline?: number;
  claimedAt?: number;
  assignHistory?: Array<{ uid: string; at: number; reason: string }>;
  /** T1 — Facebook message leads. */
  fbAccountId?: string;
  fbSender?: string;
  fbMessages?: number;
  /** T2 — cadence progress. */
  cadenceStep?: number;
  cadenceStartedAt?: number;
  cadenceStopped?: boolean;
  smsConsent?: boolean;
  lastInboundAt?: number;
  /** T3 — quote / appointment / trade-in / pre-qual. */
  quoteCode?: string;
  quoteSentAt?: number;
  quoteOpenedAt?: number;
  quoteInterestedAt?: number;
  appointmentId?: string;
  appointmentAt?: number;
  testDriveAt?: number;
  hasTrade?: boolean;
  tradeInId?: string;
  tradeValue?: number;
  prequalId?: string;
  prequalStatus?: PrequalStatus;
  creditTier?: 'A' | 'B' | 'C' | 'D' | 'E';
  /** T5 — referral that brought this lead. */
  referralCode?: string;
  /** T5 — this buyer's own referral code (made when the lead is sold). */
  myReferralCode?: string;
  referralCountedAt?: number;
  referralRewardAt?: number;
  referralRewardAmount?: number;
  /** Similar-model interest (for price drops / sold-similar). */
  interestModel?: string;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type SmsKind =
  | 'manual' | 'auto_lead' | 'missed_call' | 'cadence' | 'price_drop' | 'similar' | 'appointment' | 'no_show'
  | 'quote' | 'prequal' | 'trade_in' | 'referral' | 'service' | 'reply';

/** mp_sms: one text (outbox + log). */
export interface SmsDoc {
  id: string;
  to: string;
  body: string;
  kind: SmsKind;
  storeId: string;
  leadId?: string;
  customerId?: string;
  appointmentId?: string;
  createdBy: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
  provider?: 'phone' | 'twilio';
  deviceId?: string;
  sendAt: number;
  attempts: number;
  error?: string;
  createdAt: number;
  sentAt?: number;
}

/** mp_sms_inbound: a reply from a customer. */
export interface SmsInbound {
  id: string;
  from: string;
  body: string;
  storeId?: string;
  leadId?: string;
  receivedAt: number;
  via: 'twilio' | 'phone';
}

/** mp_tasks: a to-do on the "Today" list. */
export interface SalesTask {
  id: string;
  ownerUid: string;
  leadId?: string;
  customerId?: string;
  kind: 'cadence' | 'service' | 'callback' | 'quote_opened' | 'price_drop' | 'appointment' | 'other';
  title: string;
  /** Message to send with one tap (text tasks). */
  suggestedText?: string;
  channel?: 'sms' | 'call' | 'email';
  phone?: string;
  dueAt: number;
  status: 'open' | 'done' | 'skipped';
  createdAt: number;
  doneAt?: number;
}

export interface QuoteRow {
  lender: string;
  rateLabel: string;
  term: number;
  payment: number;
  totalOfPayments: number;
  note?: string;
}

/** mp_quotes/{code}: a quote the customer opens at /q/{code}. */
export interface Quote {
  id: string;
  code: string;
  leadId?: string;
  cartId?: string;
  cartTitle: string;
  photo?: string;
  videoUrl?: string;
  brand: string;
  cartPrice: number;
  accessories: number;
  prepFee: number;
  deliveryFee: number;
  /** Delivery over 4 hours goes by 3rd-party carrier: price to be confirmed (not in deliveryFee / otd). */
  deliveryTbc?: boolean;
  militaryDiscount: number;
  salesTax: number;
  otd: number;
  downPayment: number;
  loanAmount: number;
  rows: QuoteRow[];
  salespersonUid: string;
  salespersonName: string;
  salespersonPhone: string;
  storeId: string;
  customerName?: string;
  customerPhone?: string;
  createdAt: number;
  expiresAt: number;
  openedAt?: number;
  openCount?: number;
  interestedAt?: number;
}

export type AppointmentStatus = 'booked' | 'showed' | 'no_show' | 'cancelled';

/** mp_appointments. */
export interface Appointment {
  id: string;
  storeId: string;
  leadId?: string;
  ownerUid?: string;
  name: string;
  phone: string;
  email?: string;
  kind: 'test_drive' | 'visit' | 'delivery' | 'service';
  cartId?: string;
  cartTitle?: string;
  startAt: number;
  endAt: number;
  status: AppointmentStatus;
  source: 'public' | 'staff';
  notes?: string;
  remindedDayBefore?: boolean;
  remindedSoon?: boolean;
  noShowTextedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** mp_trade_ins. */
export interface TradeIn {
  id: string;
  leadId?: string;
  storeId?: string;
  name: string;
  phone: string;
  email?: string;
  year: number;
  brand: string;
  model: string;
  condition: 'excellent' | 'good' | 'fair' | 'poor';
  electric: boolean;
  batteryYear?: number;
  lifted?: boolean;
  notes?: string;
  photos: string[];
  estimateLow: number;
  estimateHigh: number;
  /** Final value set by a manager after inspection. */
  appraisedValue?: number;
  status: 'new' | 'appraised' | 'accepted' | 'declined';
  createdAt: number;
}

export type PrequalStatus = 'started' | 'sent_to_lender' | 'approved' | 'declined' | 'needs_info';

/** mp_prequal. */
export interface Prequal {
  id: string;
  leadId?: string;
  storeId?: string;
  name: string;
  phone: string;
  email?: string;
  /** Self-reported. */
  creditRange: 'excellent' | 'good' | 'fair' | 'building';
  monthlyBudget?: number;
  downPayment?: number;
  lender?: string;
  status: PrequalStatus;
  creditTier?: 'A' | 'B' | 'C' | 'D' | 'E';
  approvedAmount?: number;
  createdAt: number;
  updatedAt: number;
}

/** mp_referrals/{code}. */
export interface Referral {
  id: string;
  code: string;
  customerId?: string;
  leadId?: string;
  name: string;
  phone: string;
  storeId?: string;
  leads: number;
  sales: number;
  rewardsOwed: number;
  rewardsPaid: number;
  createdAt: number;
  lastUsedAt?: number;
}

/** mp_price_changes. */
export interface PriceChange {
  id: string;
  cartId: string;
  cartTitle: string;
  oldPrice: number;
  newPrice: number;
  at: number;
  leadsTexted: number;
  accountsToEdit: string[];
}

/** mp_reviews/{storeId}: latest Google rating snapshot. */
export interface StoreReviews {
  id: string;
  storeId: string;
  placeId: string;
  rating: number;
  count: number;
  /** Count a week ago / a month ago (for trends). */
  countWeekAgo?: number;
  countMonthAgo?: number;
  latest: Array<{ author: string; rating: number; text: string; time: number; uri?: string }>;
  updatedAt: number;
  error?: string;
}
