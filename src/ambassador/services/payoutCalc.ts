// Pure Phase 3 rules — no DB, no clock. Money in integer paise.
// Spec: distribution/docs/06-pricing-commission-engine.md §6.8 and the
// payout section.

export interface EligibilityInput {
  now: Date;
  holdDays: number;
  commission: { status: string; hold: unknown; deliveredAt?: Date | null };
  order: {
    status?: string;
    paymentStatus?: string;
    paymentMethod?: string;
    total?: number;
    advanceAmount?: number;
    codCollected?: { at?: Date | null } | null;
    cancellation?: { status?: string } | null;
    refund?: { id?: string; status?: string } | null;
    shipment?: { deliveredAt?: Date | null } | null;
  } | null;
  partnerStatus?: string | null;
}

export type NotEligibleReason =
  | "not_delivery_confirmed"
  | "on_hold"
  | "order_missing"
  | "not_delivered"
  | "not_paid"
  | "cod_not_collected"
  | "cancellation_open"
  | "refunded"
  | "partner_not_active"
  | "hold_period";

export type EligibilityResult = { eligible: true; deliveredAt: Date } | { eligible: false; reason: NotEligibleReason; eligibleFrom?: Date };

// delivery_confirmed → eligible when: order Delivered and Paid, COD balance
// collected, no open cancellation or refund, no hold, partner active, and
// holdDays (the return window) have passed since delivery.
export function checkEligibility(i: EligibilityInput): EligibilityResult {
  const { commission: c, order: o } = i;
  if (c.status !== "delivery_confirmed") return { eligible: false, reason: "not_delivery_confirmed" };
  if (c.hold) return { eligible: false, reason: "on_hold" };
  if (!o) return { eligible: false, reason: "order_missing" };
  if (o.status !== "Delivered") return { eligible: false, reason: "not_delivered" };
  if (o.paymentStatus === "Refunded" || o.refund?.id) return { eligible: false, reason: "refunded" };
  if (o.paymentStatus !== "Paid") return { eligible: false, reason: "not_paid" };
  // COD orders are "Paid" once the advance is in; the balance must be collected too.
  const codBalance = (o.total || 0) - (o.advanceAmount || 0);
  if (o.paymentMethod === "COD" && codBalance > 0 && !o.codCollected?.at) return { eligible: false, reason: "cod_not_collected" };
  if (o.cancellation?.status === "Requested" || o.cancellation?.status === "Approved") return { eligible: false, reason: "cancellation_open" };
  if (i.partnerStatus !== "active") return { eligible: false, reason: "partner_not_active" };
  const delivered = c.deliveredAt || o.shipment?.deliveredAt;
  if (!delivered) return { eligible: false, reason: "not_delivered" };
  const from = new Date(new Date(delivered).getTime() + Math.max(0, i.holdDays) * 86400000);
  if (from > i.now) return { eligible: false, reason: "hold_period", eligibleFrom: from };
  return { eligible: true, deliveredAt: new Date(delivered) };
}

export interface PayoutTotals {
  grossPaise: number;
  adjustmentsPaise: number;
  tdsPercent: number;
  tdsPaise: number;
  netPaise: number;
}

// TDS (if configured) is deducted from the positive total of commission +
// adjustments. Rounded down to the paisa. The rate is a setting (default 0)
// until the accountant confirms the treatment (decisions Q7).
export function payoutTotals(commissionsPaise: number[], adjustmentsPaise: number[], tdsPercent: number): PayoutTotals {
  const gross = commissionsPaise.reduce((a, b) => a + b, 0);
  const adj = adjustmentsPaise.reduce((a, b) => a + b, 0);
  const pct = Math.min(30, Math.max(0, Number.isFinite(tdsPercent) ? tdsPercent : 0));
  const base = Math.max(0, gross + adj);
  const tds = Math.floor((base * pct) / 100);
  return { grossPaise: gross, adjustmentsPaise: adj, tdsPercent: pct, tdsPaise: tds, netPaise: gross + adj - tds };
}

export const PAYOUT_REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9 /_.-]{3,99}$/;
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;
