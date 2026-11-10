// Pure attribution decision — who (if anyone) gets credit for an order.
// Spec: distribution/docs/07-attribution.md. The caller (orderHooks) does the
// DB reads and passes only ACTIVE partners' candidates in.

export type AttributionType = "referral_link" | "lead" | "manual";
export type HoldReason =
  | "self_referral"
  | "existing_customer"
  | "no_rule"
  | "below_floor"
  | "attribution_conflict"
  | "partner_not_active"
  | "manual";

export interface Candidate {
  ambassadorId: string;
  type: AttributionType;
  at: Date; // when the source was established (link click / lead creation)
  code?: string;
  leadId?: string;
}

export interface PartnerFacts {
  userId: string;
  phone: string;
}

export interface AttributionInput {
  candidates: Candidate[];
  partners: Record<string, PartnerFacts>;
  buyer: { userId?: string | null; phones: string[] };
  // Earliest paid, non-cancelled order by this buyer created before THIS order.
  buyerFirstPriorPaidOrderAt: Date | null;
}

export interface AttributionResult {
  winner: Candidate;
  conflictWith: string[]; // other ambassador ids that also had a valid claim
  holds: HoldReason[]; // most serious first
}

const HOLD_PRIORITY: HoldReason[] = ["self_referral", "attribution_conflict", "existing_customer"];

export function decideAttribution(input: AttributionInput): AttributionResult | null {
  if (!input.candidates.length) return null;

  // First valid source wins; ties broken by referral link before lead, then id
  // (deterministic, so a replayed hook always picks the same winner).
  const sorted = [...input.candidates].sort((a, b) => {
    const t = a.at.getTime() - b.at.getTime();
    if (t !== 0) return t;
    if (a.type !== b.type) return a.type === "referral_link" ? -1 : 1;
    return a.ambassadorId.localeCompare(b.ambassadorId);
  });
  const winner = sorted[0];
  const conflictWith = Array.from(new Set(sorted.map((c) => c.ambassadorId).filter((id) => id !== winner.ambassadorId)));

  const holds = new Set<HoldReason>();
  const partner = input.partners[winner.ambassadorId];
  if (partner) {
    const buyerPhones = input.buyer.phones.filter(Boolean);
    if ((input.buyer.userId && input.buyer.userId === partner.userId) || buyerPhones.includes(partner.phone)) {
      holds.add("self_referral");
    }
  }
  if (conflictWith.length) holds.add("attribution_conflict");
  if (input.buyerFirstPriorPaidOrderAt && input.buyerFirstPriorPaidOrderAt < winner.at) {
    holds.add("existing_customer");
  }

  return {
    winner,
    conflictWith,
    holds: HOLD_PRIORITY.filter((h) => holds.has(h)),
  };
}

// Referral capture time from the browser is untrusted: clamp it into
// [orderCreatedAt - windowDays, orderCreatedAt]. Missing/garbage → order time.
export function clampCapturedAt(raw: unknown, orderCreatedAt: Date, windowDays: number): Date {
  const d = typeof raw === "string" || typeof raw === "number" ? new Date(raw) : null;
  const min = orderCreatedAt.getTime() - windowDays * 86400000;
  if (!d || Number.isNaN(d.getTime())) return orderCreatedAt;
  return new Date(Math.min(Math.max(d.getTime(), min), orderCreatedAt.getTime()));
}

export const PARTNER_CODE_RE = /^LSA-\d{6}$/;

export function formatPartnerCode(seq: number): string {
  return `LSA-${String(seq + 100).padStart(6, "0")}`;
}

export function normalizePartnerCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return PARTNER_CODE_RE.test(code) ? code : null;
}
