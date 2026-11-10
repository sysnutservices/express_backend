// Hand-written validators (codebase convention — no Zod). Each returns
// either { ok: true, value } with a clean, typed object, or { ok: false,
// errors } keyed by field. Nothing from req.body reaches Mongo unvalidated.
import { normalizePhone, rupeesToPaise } from "./money";
import type { PartnerType } from "./services/commissionCalc";

export type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const str = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.]{1,63}$/;
const PINCODE_RE = /^[1-9]\d{5}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export interface RegistrationInput {
  partnerType: PartnerType;
  fullName: string;
  email: string;
  dateOfBirth: Date;
  address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  occupation?: string;
  heardFrom?: string;
  business?: { name?: string; gstin?: string };
  pan: string;
  payout: { method: "upi"; upiId: string } | { method: "bank"; accountName: string; accountNumber: string; ifsc: string };
  agreementVersion: string;
}

export function validateRegistration(body: any, opts: { minimumAge: number; agreementVersion: string; now?: Date }): Result<RegistrationInput> {
  const e: Record<string, string> = {};
  const b = body && typeof body === "object" ? body : {};

  const partnerType = b.partnerType;
  if (partnerType !== "referral" && partnerType !== "independent") e.partnerType = "Choose Referral or Independent Sales";

  const fullName = str(b.fullName, 100);
  if (!fullName || fullName.length < 2) e.fullName = "Enter your full name";

  const email = str(b.email, 254)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) e.email = "Enter a valid email address";

  let dateOfBirth: Date | undefined;
  if (typeof b.dateOfBirth !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.dateOfBirth)) e.dateOfBirth = "Enter your date of birth";
  else {
    dateOfBirth = new Date(b.dateOfBirth + "T00:00:00Z");
    if (Number.isNaN(dateOfBirth.getTime())) e.dateOfBirth = "Enter a valid date";
    else if (ageOn(dateOfBirth, opts.now || new Date()) < opts.minimumAge) e.dateOfBirth = `You must be at least ${opts.minimumAge} years old`;
  }

  const a = b.address && typeof b.address === "object" ? b.address : {};
  const address = {
    line1: str(a.line1, 200) || "",
    line2: str(a.line2, 200),
    city: str(a.city, 80) || "",
    state: str(a.state, 80) || "",
    pincode: str(a.pincode, 6) || "",
  };
  if (!address.line1) e["address.line1"] = "Enter your address";
  if (!address.city) e["address.city"] = "Enter your city";
  if (!address.state) e["address.state"] = "Enter your state";
  if (!PINCODE_RE.test(address.pincode)) e["address.pincode"] = "Enter a valid 6-digit pincode";

  const pan = str(b.pan, 10)?.toUpperCase();
  if (!pan || !PAN_RE.test(pan)) e.pan = "Enter a valid PAN (e.g. ABCDE1234F)";

  let payout: RegistrationInput["payout"] | undefined;
  const p = b.payout && typeof b.payout === "object" ? b.payout : {};
  if (p.method === "upi") {
    const upiId = str(p.upiId, 256);
    if (!upiId || !UPI_RE.test(upiId)) e["payout.upiId"] = "Enter a valid UPI ID";
    else payout = { method: "upi", upiId };
  } else if (p.method === "bank") {
    const accountName = str(p.accountName, 100);
    const accountNumber = str(p.accountNumber, 18)?.replace(/\s/g, "");
    const ifsc = str(p.ifsc, 11)?.toUpperCase();
    if (!accountName) e["payout.accountName"] = "Enter the account holder name";
    if (!accountNumber || !/^\d{9,18}$/.test(accountNumber)) e["payout.accountNumber"] = "Enter a valid account number";
    if (!ifsc || !IFSC_RE.test(ifsc)) e["payout.ifsc"] = "Enter a valid IFSC";
    if (accountName && accountNumber && ifsc) payout = { method: "bank", accountName, accountNumber, ifsc };
  } else e["payout.method"] = "Choose UPI or bank transfer";

  let business: RegistrationInput["business"];
  if (b.business && typeof b.business === "object") {
    const name = str(b.business.name, 120);
    const gstin = str(b.business.gstin, 15)?.toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) e["business.gstin"] = "Enter a valid GSTIN";
    if (name || gstin) business = { name, gstin };
  }

  if (b.acceptAgreement !== true) e.acceptAgreement = "You must accept the programme agreement";
  if (b.agreementVersion !== opts.agreementVersion) e.agreementVersion = "The agreement has been updated — please review and accept the current version";

  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      partnerType,
      fullName: fullName!,
      email: email!,
      dateOfBirth: dateOfBirth!,
      address,
      occupation: str(b.occupation, 100),
      heardFrom: str(b.heardFrom, 100),
      business,
      pan: pan!,
      payout: payout!,
      agreementVersion: opts.agreementVersion,
    },
  };
}

export const LEAD_STATUSES = ["new", "contacted", "qualified", "quotation_sent", "negotiation", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const CUSTOMER_TYPES = ["individual", "student", "professional", "business", "other"] as const;

export interface LeadInput {
  customerName: string;
  phone: string;
  email?: string;
  location?: string;
  customerType: (typeof CUSTOMER_TYPES)[number];
  requirements?: string;
  preferredSpecs?: string;
  budgetPaise?: number;
  source?: string;
  followUpAt?: Date;
  notes?: string;
}

function optionalDate(v: unknown, field: string, e: Record<string, string>): Date | undefined | null {
  if (v === undefined || v === null || v === "") return v === null || v === "" ? null : undefined;
  const d = new Date(v as any);
  if (typeof v !== "string" || Number.isNaN(d.getTime())) {
    e[field] = "Enter a valid date";
    return undefined;
  }
  return d;
}

export function validateLeadCreate(body: any): Result<LeadInput> {
  const e: Record<string, string> = {};
  const b = body && typeof body === "object" ? body : {};
  const customerName = str(b.customerName, 100);
  if (!customerName) e.customerName = "Enter the customer's name";
  const phone = normalizePhone(b.phone);
  if (!phone) e.phone = "Enter a valid 10-digit Indian mobile number";
  const email = str(b.email, 254)?.toLowerCase();
  if (email && !EMAIL_RE.test(email)) e.email = "Enter a valid email address";
  const customerType = b.customerType ?? "individual";
  if (!CUSTOMER_TYPES.includes(customerType)) e.customerType = "Invalid customer type";
  let budgetPaise: number | undefined;
  if (b.budget !== undefined && b.budget !== null && b.budget !== "") {
    const n = Number(b.budget);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) e.budget = "Enter a valid budget in rupees";
    else budgetPaise = rupeesToPaise(n);
  }
  const followUpAt = optionalDate(b.followUpAt, "followUpAt", e) || undefined;
  if (b.consent !== true) e.consent = "Confirm the customer agreed to be contacted by Lapshark";

  if (Object.keys(e).length) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      customerName: customerName!,
      phone: phone!,
      email,
      location: str(b.location, 120),
      customerType,
      requirements: str(b.requirements, 2000),
      preferredSpecs: str(b.preferredSpecs, 1000),
      budgetPaise,
      source: str(b.source, 60),
      followUpAt,
      notes: str(b.notes, 2000),
    },
  };
}

export interface LeadUpdateInput {
  status?: LeadStatus;
  lostReason?: string;
  followUpAt?: Date | null;
  notes?: string;
  requirements?: string;
  preferredSpecs?: string;
  budgetPaise?: number;
  location?: string;
}

// Partners can move a lead through the pipeline but cannot mark it "won" —
// "won" is set only when a real paid order is matched (orderHooks).
export function validateLeadUpdate(body: any): Result<LeadUpdateInput> {
  const e: Record<string, string> = {};
  const b = body && typeof body === "object" ? body : {};
  const out: LeadUpdateInput = {};
  if (b.status !== undefined) {
    if (!LEAD_STATUSES.includes(b.status) || b.status === "won") e.status = "Invalid status";
    else out.status = b.status;
  }
  if (b.lostReason !== undefined) out.lostReason = str(b.lostReason, 500);
  if (b.followUpAt !== undefined) {
    const d = optionalDate(b.followUpAt, "followUpAt", e);
    if (d !== undefined) out.followUpAt = d;
  }
  for (const k of ["notes", "requirements", "preferredSpecs", "location"] as const) {
    if (b[k] !== undefined) out[k] = str(b[k], k === "location" ? 120 : 2000) || "";
  }
  if (b.budget !== undefined) {
    const n = Number(b.budget);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) e.budget = "Enter a valid budget in rupees";
    else out.budgetPaise = rupeesToPaise(n);
  }
  if (Object.keys(e).length) return { ok: false, errors: e };
  if (!Object.keys(out).length) return { ok: false, errors: { _: "Nothing to update" } };
  return { ok: true, value: out };
}

// Admin rule body arrives in RUPEES (friendlier for the form) and is
// converted to paise here; validateRuleShape then checks the paise shape.
export function ruleBodyToPaise(b: any) {
  const toP = (v: unknown) => (v === null || v === undefined || v === "" ? null : typeof v === "number" || typeof v === "string" ? rupeesToPaise(Number(v)) : NaN);
  return {
    partnerType: b?.partnerType,
    productId: b?.productId || null,
    kind: b?.kind,
    slabs: Array.isArray(b?.slabs)
      ? b.slabs.map((s: any) => ({ minPricePaise: toP(s?.minPrice), maxPricePaise: toP(s?.maxPrice), commissionPaise: toP(s?.commission) }))
      : undefined,
    minimumPricePaise: toP(b?.minimumPrice),
    baseCommissionPaise: toP(b?.baseCommission),
    marginSharePercent: b?.marginSharePercent === undefined || b?.marginSharePercent === null || b?.marginSharePercent === "" ? null : Number(b.marginSharePercent),
    validFrom: b?.validFrom ? new Date(b.validFrom) : undefined,
    validUntil: b?.validUntil ? new Date(b.validUntil) : undefined,
    notes: str(b?.notes, 500),
  };
}
