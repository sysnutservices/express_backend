// Pure commission maths — no DB, no clock. Every number is integer paise.
// Spec: distribution/docs/06-pricing-commission-engine.md.

export type PartnerType = "referral" | "independent";
export type RuleKind = "slab" | "margin_share";

export interface Slab {
  minPricePaise: number;
  maxPricePaise: number | null; // null = no upper bound
  commissionPaise: number;
}

export interface CommissionRuleLike {
  _id?: unknown;
  partnerType: PartnerType;
  productId?: unknown;
  kind: RuleKind;
  slabs?: Slab[];
  minimumPricePaise?: number | null;
  baseCommissionPaise?: number | null;
  marginSharePercent?: number | null;
  version?: number;
}

export type CalcReason = "slab" | "margin_share" | "below_slab" | "above_slab" | "below_floor" | "no_rule" | "special_approval";

export interface UnitCommission {
  perUnitPaise: number;
  reason: CalcReason;
  // below_floor / no_rule need a human; below_slab is simply "no commission".
  needsReview: boolean;
}

// addOnPaise = RAM/SSD/warranty upgrade cost included in the unit price.
// Add-ons are sold at face value: for margin_share they raise the floor by
// the same amount, so no margin share is paid on an upgrade and a discount
// can't be hidden inside one (docs/06 §6.4, decision D13). Slabs look at the
// full unit price, as before.
export function commissionPerUnit(rule: CommissionRuleLike | null | undefined, unitSellingPricePaise: number, addOnPaise = 0): UnitCommission {
  if (!rule) return { perUnitPaise: 0, reason: "no_rule", needsReview: true };

  if (rule.kind === "slab") {
    const slab = (rule.slabs || []).find(
      (s) => unitSellingPricePaise >= s.minPricePaise && (s.maxPricePaise === null || s.maxPricePaise === undefined || unitSellingPricePaise <= s.maxPricePaise)
    );
    if (!slab) {
      // Above every bounded slab = "admin-defined" territory in the spec
      // (e.g. ₹40,001+): hold for a human instead of silently paying ₹0.
      const slabs = rule.slabs || [];
      const top = slabs.reduce<number | null>((m, s) => (s.maxPricePaise === null || s.maxPricePaise === undefined ? m : Math.max(m ?? 0, s.maxPricePaise)), null);
      const openEnded = slabs.some((s) => s.maxPricePaise === null || s.maxPricePaise === undefined);
      if (!openEnded && top !== null && unitSellingPricePaise > top) return { perUnitPaise: 0, reason: "above_slab", needsReview: true };
      return { perUnitPaise: 0, reason: "below_slab", needsReview: false };
    }
    return { perUnitPaise: slab.commissionPaise, reason: "slab", needsReview: false };
  }

  const floor = (rule.minimumPricePaise ?? 0) + Math.max(0, addOnPaise || 0);
  if (unitSellingPricePaise < floor) return { perUnitPaise: 0, reason: "below_floor", needsReview: true };
  const base = rule.baseCommissionPaise ?? 0;
  const share = rule.marginSharePercent ?? 0;
  // Floor, not round: any sub-paisa remainder stays with Lapshark.
  const extra = Math.floor(((unitSellingPricePaise - floor) * share) / 100);
  return { perUnitPaise: base + extra, reason: "margin_share", needsReview: false };
}

export interface OrderLineInput {
  itemId: string;
  unitPricePaise: number; // Order.items[].finalPrice (incl. config add-ons + extra offer), in paise
  quantity: number;
}

export interface LineSellingPrice {
  itemId: string;
  quantity: number;
  lineGrossPaise: number;
  couponSharePaise: number;
  unitSellingPricePaise: number;
}

// Spreads an order-level coupon across lines pro-rata to line value. The
// last line absorbs the rounding remainder so the shares sum exactly to the
// coupon (never more than the line itself). Shipping is never included.
export function allocateSellingPrices(lines: OrderLineInput[], couponPaise: number): LineSellingPrice[] {
  const gross = lines.map((l) => Math.max(0, l.unitPricePaise) * Math.max(1, l.quantity));
  const total = gross.reduce((a, b) => a + b, 0);
  const coupon = Math.max(0, Math.min(couponPaise || 0, total));
  let allocated = 0;
  return lines.map((l, i) => {
    const qty = Math.max(1, l.quantity);
    let share: number;
    if (total === 0) share = 0;
    else if (i === lines.length - 1) share = coupon - allocated;
    else share = Math.floor((coupon * gross[i]) / total);
    share = Math.min(share, gross[i]);
    allocated += share;
    return {
      itemId: l.itemId,
      quantity: qty,
      lineGrossPaise: gross[i],
      couponSharePaise: share,
      unitSellingPricePaise: Math.floor((gross[i] - share) / qty),
    };
  });
}

// Most specific active rule wins: SKU rule, else the partner type's default.
export function pickRule<R extends CommissionRuleLike>(rules: R[], partnerType: PartnerType, productId: string | null, now: Date = new Date()): R | null {
  const live = rules.filter((r: any) => {
    if (r.partnerType !== partnerType) return false;
    if (r.status && r.status !== "active") return false;
    if (r.validFrom && new Date(r.validFrom) > now) return false;
    if (r.validUntil && new Date(r.validUntil) <= now) return false;
    return true;
  });
  const sku = productId ? live.find((r) => r.productId && String(r.productId) === productId) : undefined;
  return sku || live.find((r) => !r.productId) || null;
}

// Validates a rule body (amounts already in paise). Returns field errors.
export function validateRuleShape(rule: Partial<CommissionRuleLike>): Record<string, string> {
  const errors: Record<string, string> = {};
  const int = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (rule.partnerType !== "referral" && rule.partnerType !== "independent") errors.partnerType = "must be referral or independent";
  if (rule.kind === "slab") {
    const slabs = rule.slabs;
    if (!Array.isArray(slabs) || slabs.length === 0) errors.slabs = "at least one slab is required";
    else {
      slabs.forEach((s, i) => {
        if (!int(s.minPricePaise) || !int(s.commissionPaise) || (s.maxPricePaise !== null && !int(s.maxPricePaise))) {
          errors[`slabs.${i}`] = "amounts must be non-negative whole paise";
        } else if (s.maxPricePaise !== null && s.maxPricePaise < s.minPricePaise) {
          errors[`slabs.${i}`] = "max must be >= min";
        }
      });
      for (let i = 1; i < slabs.length; i++) {
        const prev = slabs[i - 1];
        if (prev.maxPricePaise === null || slabs[i].minPricePaise <= prev.maxPricePaise) {
          errors.slabs = "slabs must be ascending and non-overlapping (only the last may be open-ended)";
          break;
        }
      }
    }
  } else if (rule.kind === "margin_share") {
    if (!int(rule.minimumPricePaise)) errors.minimumPricePaise = "required, non-negative whole paise";
    if (!int(rule.baseCommissionPaise)) errors.baseCommissionPaise = "required, non-negative whole paise";
    const p = rule.marginSharePercent;
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100) errors.marginSharePercent = "must be 0-100";
  } else {
    errors.kind = "must be slab or margin_share";
  }
  return errors;
}

// The spec's illustrative referral slab (₹15,000-₹40,000). Offered to the
// admin as a starting template only — never auto-activated (decision D6).
export const ILLUSTRATIVE_REFERRAL_SLABS: Slab[] = [
  { minPricePaise: 1_500_000, maxPricePaise: 2_000_000, commissionPaise: 30_000 },
  { minPricePaise: 2_000_001, maxPricePaise: 2_500_000, commissionPaise: 50_000 },
  { minPricePaise: 2_500_001, maxPricePaise: 3_000_000, commissionPaise: 65_000 },
  { minPricePaise: 3_000_001, maxPricePaise: 4_000_000, commissionPaise: 75_000 },
];
