// Pure dealer-channel rules (no DB), unit-tested in dealer.selftest.ts.
// Hand-written validators, same convention as ambassador/validation.ts:
// nothing from req.body reaches Mongo unvalidated. Money is integer paise.
import { isPaise } from "../ambassador/money";
import type { ClaimType, DealerOrderStatus, DealerPaymentMethod } from "./models/DealerOrder";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t.slice(0, max) : undefined;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
export const MAX_QTY_PER_LINE = 100;
export const MAX_LINES = 30;

export const formatDealerCode = (n: number) => `DLR-${String(n).padStart(4, "0")}`;
export const formatDealerOrderNumber = (n: number) => `LSD-${String(n).padStart(6, "0")}`;

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

function validateAddress(a: any, e: Record<string, string>, prefix = "address"): Address | undefined {
  if (!a || typeof a !== "object") {
    e[prefix] = "Address is required";
    return undefined;
  }
  const line1 = str(a.line1, 200);
  const line2 = str(a.line2, 200);
  const city = str(a.city, 80);
  const state = str(a.state, 80);
  const pincode = str(a.pincode, 6);
  if (!line1) e[`${prefix}.line1`] = "Address is required";
  if (!city) e[`${prefix}.city`] = "City is required";
  if (!state) e[`${prefix}.state`] = "State is required";
  if (!pincode || !PINCODE_RE.test(pincode)) e[`${prefix}.pincode`] = "Enter a valid 6-digit pincode";
  if (!line1 || !city || !state || !pincode || !PINCODE_RE.test(pincode)) return undefined;
  return { line1, line2, city, state, pincode };
}

// ---- Vetting answers (application and enquiry) ----
// Shown to the admin reviewing an application; the frontend mirrors these
// codes and labels in lib/dealerApi.ts.
export const DEALER_BUSINESS_TYPES = ["retail_shop", "online_seller", "it_reseller", "refurbisher", "other"] as const;
export const DEALER_YEARS_IN_BUSINESS = ["lt1", "1to3", "3to5", "5plus"] as const;
export const DEALER_MONTHLY_VOLUMES = ["1to5", "6to20", "21to50", "50plus"] as const;
export type DealerBusinessType = (typeof DEALER_BUSINESS_TYPES)[number];
export type DealerYearsInBusiness = (typeof DEALER_YEARS_IN_BUSINESS)[number];
export type DealerMonthlyVolume = (typeof DEALER_MONTHLY_VOLUMES)[number];

const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined);

export interface DealerVetting {
  businessType: DealerBusinessType;
  yearsInBusiness: DealerYearsInBusiness;
  monthlyVolume: DealerMonthlyVolume;
  interests?: string;
}

function validateVetting(b: any, e: Record<string, string>): DealerVetting | undefined {
  const businessType = oneOf(b.businessType, DEALER_BUSINESS_TYPES);
  const yearsInBusiness = oneOf(b.yearsInBusiness, DEALER_YEARS_IN_BUSINESS);
  const monthlyVolume = oneOf(b.monthlyVolume, DEALER_MONTHLY_VOLUMES);
  if (!businessType) e.businessType = "Choose your type of business";
  if (!yearsInBusiness) e.yearsInBusiness = "Choose how long you've been in business";
  if (!monthlyVolume) e.monthlyVolume = "Choose how many laptops you expect to buy a month";
  if (!businessType || !yearsInBusiness || !monthlyVolume) return undefined;
  return { businessType, yearsInBusiness, monthlyVolume, interests: str(b.interests, 300) };
}

// ---- Registration ----
export interface DealerRegistrationInput {
  businessName: string;
  contactName: string;
  email?: string;
  gstin?: string;
  pan?: string;
  address: Address;
  vetting: DealerVetting;
  agreementVersion: string;
}

export function validateDealerRegistration(b: any, opts: { agreementVersion: string }): Result<DealerRegistrationInput> {
  const e: Record<string, string> = {};
  b = b && typeof b === "object" ? b : {};
  const businessName = str(b.businessName, 120);
  const contactName = str(b.contactName, 120);
  if (!businessName || businessName.length < 2) e.businessName = "Business name is required";
  if (!contactName || contactName.length < 2) e.contactName = "Contact name is required";
  const email = str(b.email, 200)?.toLowerCase();
  if (email && !EMAIL_RE.test(email)) e.email = "Enter a valid email";
  const gstin = str(b.gstin, 15)?.toUpperCase().replace(/\s/g, "");
  const pan = str(b.pan, 10)?.toUpperCase().replace(/\s/g, "");
  if (gstin && !GSTIN_RE.test(gstin)) e.gstin = "Enter a valid GSTIN";
  if (pan && !PAN_RE.test(pan)) e.pan = "Enter a valid PAN (e.g. ABCDE1234F)";
  if (!gstin && !pan) e.gstin = "Enter your GSTIN or your PAN";
  const address = validateAddress(b.address, e);
  const vetting = validateVetting(b, e);
  if (b.agreementVersion !== opts.agreementVersion) e.agreement = "Please accept the current dealer terms";
  if (b.noWarrantyAcknowledged !== true) e.noWarrantyAcknowledged = "Please confirm you understand laptops come without Lapshark warranty unless you add it";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, value: { businessName: businessName!, contactName: contactName!, email, gstin, pan, address: address!, vetting: vetting!, agreementVersion: opts.agreementVersion } };
}

// ---- Enquiry (public, no login, while registration is closed) ----
// Contact details for a call back, nothing sensitive: no GSTIN/PAN, no
// address. The phone is not OTP-verified, same as the ambassador waitlist.
export interface DealerEnquiryInput {
  businessName: string;
  contactName: string;
  city: string;
  businessType: DealerBusinessType;
  monthlyVolume: DealerMonthlyVolume;
  message?: string;
  gstin?: string; // optional; format-checked only, not verified with the GST portal
}

export function validateDealerEnquiry(b: any): Result<DealerEnquiryInput> {
  const e: Record<string, string> = {};
  b = b && typeof b === "object" ? b : {};
  const businessName = str(b.businessName, 120);
  const contactName = str(b.contactName, 120);
  const city = str(b.city, 80);
  const businessType = oneOf(b.businessType, DEALER_BUSINESS_TYPES);
  const monthlyVolume = oneOf(b.monthlyVolume, DEALER_MONTHLY_VOLUMES);
  if (!businessName || businessName.length < 2) e.businessName = "Business name is required";
  if (!contactName || contactName.length < 2) e.contactName = "Your name is required";
  if (!city) e.city = "City is required";
  if (!businessType) e.businessType = "Choose your type of business";
  if (!monthlyVolume) e.monthlyVolume = "Choose how many laptops you expect to buy a month";
  const gstin = typeof b.gstin === "string" ? b.gstin.toUpperCase().replace(/\s/g, "").slice(0, 20) || undefined : undefined;
  if (gstin && !GSTIN_RE.test(gstin)) e.gstin = "Enter a valid 15-character GSTIN, or leave it blank";
  if (b.consent !== true) e.consent = "Please agree to be contacted about buying as a dealer";
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, value: { businessName: businessName!, contactName: contactName!, city: city!, businessType: businessType!, monthlyVolume: monthlyVolume!, message: str(b.message, 500), gstin } };
}

// ---- Pricing an order (server-side only; the client sends ids and quantities) ----
export interface CatalogueEntry {
  productId: string;
  title: string;
  condition?: string;
  image?: string;
  stock: number;
  pricePaise: number;
  warranty?: { months: number; pricePaise: number } | null;
}

export interface PricedLine {
  productId: string;
  title: string;
  condition?: string;
  image?: string;
  quantity: number;
  unitPricePaise: number;
  warrantyMonths: number;
  warrantyPricePaise: number;
  lineTotalPaise: number;
}

export function priceDealerOrder(items: unknown, catalogue: Map<string, CatalogueEntry>): Result<{ lines: PricedLine[]; totalPaise: number }> {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, errors: { items: "Add at least one laptop" } };
  if (items.length > MAX_LINES) return { ok: false, errors: { items: `At most ${MAX_LINES} lines per order` } };
  const merged = new Map<string, { productId: string; withWarranty: boolean; quantity: number }>();
  const e: Record<string, string> = {};
  items.forEach((it: any, i) => {
    const productId = typeof it?.productId === "string" ? it.productId : "";
    const quantity = it?.quantity;
    const withWarranty = it?.withWarranty === true;
    if (!productId) e[`items.${i}`] = "Unknown laptop";
    else if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_LINE) e[`items.${i}.quantity`] = `Quantity must be 1 to ${MAX_QTY_PER_LINE}`;
    else {
      const key = `${productId}:${withWarranty ? 1 : 0}`;
      const prev = merged.get(key);
      merged.set(key, { productId, withWarranty, quantity: (prev?.quantity || 0) + quantity });
    }
  });
  if (Object.keys(e).length) return { ok: false, errors: e };

  // Stock is checked per product across both warranty variants.
  const perProduct = new Map<string, number>();
  for (const m of merged.values()) perProduct.set(m.productId, (perProduct.get(m.productId) || 0) + m.quantity);

  const lines: PricedLine[] = [];
  for (const m of merged.values()) {
    const c = catalogue.get(m.productId);
    if (!c) {
      e[m.productId] = "This laptop is not available to dealers";
      continue;
    }
    if ((perProduct.get(m.productId) || 0) > c.stock) {
      e[m.productId] = c.stock > 0 ? `Only ${c.stock} in stock: ${c.title}` : `Out of stock: ${c.title}`;
      continue;
    }
    if (m.withWarranty && !c.warranty) {
      e[m.productId] = `Warranty is not offered on ${c.title}`;
      continue;
    }
    const warrantyMonths = m.withWarranty ? c.warranty!.months : 0;
    const warrantyPricePaise = m.withWarranty ? c.warranty!.pricePaise : 0;
    const lineTotalPaise = (c.pricePaise + warrantyPricePaise) * m.quantity;
    lines.push({
      productId: m.productId,
      title: c.title,
      condition: c.condition,
      image: c.image,
      quantity: m.quantity,
      unitPricePaise: c.pricePaise,
      warrantyMonths,
      warrantyPricePaise,
      lineTotalPaise,
    });
  }
  if (Object.keys(e).length) return { ok: false, errors: e };
  const totalPaise = lines.reduce((s, l) => s + l.lineTotalPaise, 0);
  if (!isPaise(totalPaise)) return { ok: false, errors: { items: "Order total is out of range" } };
  return { ok: true, value: { lines, totalPaise } };
}

// ---- Fulfilment ----
export type FulfilmentInput = { method: "courier"; address: Address } | { method: "pickup" };

export function validateFulfilment(f: any): Result<FulfilmentInput> {
  const e: Record<string, string> = {};
  if (f?.method === "pickup") return { ok: true, value: { method: "pickup" } };
  if (f?.method !== "courier") return { ok: false, errors: { fulfilment: "Choose courier delivery or pickup" } };
  const address = validateAddress(f.address, e, "fulfilment.address");
  if (!address) return { ok: false, errors: e };
  return { ok: true, value: { method: "courier", address } };
}

export function isPaymentMethod(v: unknown): v is DealerPaymentMethod {
  return v === "bank_transfer" || v === "cash";
}

// ---- Cash limit (Income Tax Act s.269ST) ----
// Cash must be strictly below the limit for the whole order and for the
// dealer's cash received on the same (IST) day. Returns an error message or null.
export function cashLimitError(p: { orderTotalPaise: number; cashTodayPaise: number; amountPaise: number; limitPaise: number }): string | null {
  const lakh = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN");
  if (p.orderTotalPaise >= p.limitPaise) return `Cash can't be accepted for an order of ${lakh(p.limitPaise)} or more. Use bank transfer.`;
  if (p.cashTodayPaise + p.amountPaise >= p.limitPaise) {
    return `Cash from this dealer today would reach ${lakh(p.cashTodayPaise + p.amountPaise)}. It must stay below ${lakh(p.limitPaise)} a day. Use bank transfer.`;
  }
  return null;
}

// [start, end) of the IST calendar day containing `at`.
export function istDayRange(at: Date): [Date, Date] {
  const IST_MS = 330 * 60 * 1000;
  const shifted = new Date(at.getTime() + IST_MS);
  const startUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_MS;
  return [new Date(startUtc), new Date(startUtc + 24 * 60 * 60 * 1000)];
}

// ---- Payments ----
export interface PaymentInput {
  method: DealerPaymentMethod;
  amountPaise: number;
  reference: string;
  receivedAt: Date;
  note?: string;
}

export function validatePayment(b: any, opts: { outstandingPaise: number; now?: Date }): Result<PaymentInput> {
  const e: Record<string, string> = {};
  b = b && typeof b === "object" ? b : {};
  const now = opts.now || new Date();
  if (!isPaymentMethod(b.method)) e.method = "Choose bank transfer or cash";
  const amountPaise = b.amountPaise;
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) e.amountPaise = "Enter the amount received";
  else if (amountPaise > opts.outstandingPaise) e.amountPaise = "That is more than the amount due on this order";
  const reference = str(b.reference, 80);
  if (!reference) e.reference = b.method === "cash" ? "Enter the cash receipt number" : "Enter the UTR / bank reference";
  const receivedAt = b.receivedAt ? new Date(b.receivedAt) : now;
  if (Number.isNaN(receivedAt.getTime())) e.receivedAt = "Enter a valid date";
  else if (receivedAt.getTime() > now.getTime() + 5 * 60 * 1000) e.receivedAt = "Date can't be in the future";
  const note = str(b.note, 500);
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, value: { method: b.method, amountPaise, reference: reference!, receivedAt, note } };
}

// ---- Serials ----
export function normalizeDealerSerial(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9\-/.]{2,49}$/.test(s) ? s : null;
}

// Every line needs exactly `quantity` serials, unique across the order.
export function validateSerials(
  lines: { _id: string; quantity: number; title: string }[],
  input: unknown
): Result<Map<string, string[]>> {
  const e: Record<string, string> = {};
  const byLine = new Map<string, string[]>();
  const given = new Map<string, unknown>();
  if (Array.isArray(input)) for (const x of input as any[]) if (x && typeof x.lineId === "string") given.set(x.lineId, x.serials);
  const seen = new Set<string>();
  for (const l of lines) {
    const raw = given.get(l._id);
    const list = Array.isArray(raw) ? raw.map(normalizeDealerSerial) : [];
    if (list.length !== l.quantity) {
      e[l._id] = `${l.title}: enter ${l.quantity} serial number${l.quantity > 1 ? "s" : ""}`;
      continue;
    }
    if (list.some((s) => !s)) {
      e[l._id] = `${l.title}: a serial number is invalid`;
      continue;
    }
    for (const s of list as string[]) {
      if (seen.has(s)) e[l._id] = `Serial ${s} is entered twice`;
      seen.add(s);
    }
    byLine.set(l._id, list as string[]);
  }
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, value: byLine };
}

// ---- Status machine ----
const NEXT: Record<DealerOrderStatus, DealerOrderStatus[]> = {
  placed: ["paid", "cancelled"],
  paid: ["packed", "cancelled"],
  packed: ["dispatched", "delivered", "cancelled"],
  dispatched: ["delivered"],
  delivered: [],
  cancelled: [],
};
export function canTransition(from: DealerOrderStatus, to: DealerOrderStatus): boolean {
  return NEXT[from].includes(to);
}

// ---- Claims ----
// Transit damage / not as described: within claimWindowDays of delivery.
// Warranty: only on units the dealer bought warranty for, until warrantyUntil.
export function claimError(p: {
  type: ClaimType;
  deliveredAt?: Date | null;
  now: Date;
  claimWindowDays: number;
  warrantyUntil?: Date | null;
}): string | null {
  if (!p.deliveredAt) return "Claims open once the order is delivered";
  if (p.type === "warranty") {
    if (!p.warrantyUntil) return "This laptop was bought without Lapshark warranty";
    if (p.now.getTime() > p.warrantyUntil.getTime()) return "The warranty on this laptop has ended";
    return null;
  }
  const deadline = p.deliveredAt.getTime() + p.claimWindowDays * 24 * 60 * 60 * 1000;
  if (p.now.getTime() > deadline) return `Damage and mismatch claims must be raised within ${p.claimWindowDays} days of delivery`;
  return null;
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + months);
  return r;
}

export function validateClaim(b: any): Result<{ type: ClaimType; serial: string; description: string; evidenceUrl?: string }> {
  const e: Record<string, string> = {};
  b = b && typeof b === "object" ? b : {};
  const type = b.type;
  if (!["transit_damage", "not_as_described", "warranty"].includes(type)) e.type = "Choose what the problem is";
  const serial = normalizeDealerSerial(b.serial);
  if (!serial) e.serial = "Choose the laptop's serial number";
  const description = str(b.description, 2000);
  if (!description || description.length < 10) e.description = "Describe the problem (at least 10 characters)";
  let evidenceUrl = str(b.evidenceUrl, 500);
  if (evidenceUrl) {
    try {
      const u = new URL(evidenceUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad");
    } catch {
      e.evidenceUrl = "Enter a link starting with https://";
      evidenceUrl = undefined;
    }
  }
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, value: { type, serial: serial!, description: description!, evidenceUrl } };
}

// ---- Admin price input ----
export function validatePriceInput(b: any): Result<{ pricePaise: number; warranty: { months: number; pricePaise: number } | null; active: boolean }> {
  const e: Record<string, string> = {};
  b = b && typeof b === "object" ? b : {};
  if (!Number.isSafeInteger(b.pricePaise) || b.pricePaise < 100) e.pricePaise = "Enter the dealer price";
  let warranty: { months: number; pricePaise: number } | null = null;
  if (b.warranty != null) {
    const months = b.warranty.months;
    const wp = b.warranty.pricePaise;
    if (!Number.isInteger(months) || months < 1 || months > 36) e["warranty.months"] = "Warranty months must be 1 to 36";
    if (!Number.isSafeInteger(wp) || wp < 0) e["warranty.pricePaise"] = "Enter the warranty price (0 if free)";
    if (!e["warranty.months"] && !e["warranty.pricePaise"]) warranty = { months, pricePaise: wp };
  }
  const active = b.active === undefined ? true : b.active === true;
  if (Object.keys(e).length) return { ok: false, errors: e };
  return { ok: true, value: { pricePaise: b.pricePaise, warranty, active } };
}
