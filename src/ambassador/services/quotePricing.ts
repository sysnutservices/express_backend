// Pure quotation pricing — no DB, no clock. Every number is integer paise.
// Spec: distribution/docs/06-pricing-commission-engine.md §6.7 and
// docs/01 "Pricing authority":
//   Level 1  quoted = listed price                       → allowed
//   Level 2  floor ≤ quoted < listed                     → allowed (independent partner)
//   Level 3  quoted < floor, or no floor configured      → needs an approved discount request
import { CommissionRuleLike, commissionPerUnit, CalcReason } from "./commissionCalc";

export type PricingLevel = 1 | 2 | 3;

export interface QuoteLineInput {
  listedUnitPaise: number; // live catalogue price incl. extra offer + config add-ons
  configCostPaise: number; // the add-on part of listedUnitPaise (never discountable)
  quotedUnitPaise: number;
  quantity: number;
  rule: CommissionRuleLike | null; // the independent rule that applies to this SKU
}

export interface QuoteLinePrice {
  level: PricingLevel;
  floorUnitPaise: number | null; // lowest price the partner may quote alone; null = no negotiation room configured
  discountUnitPaise: number;
  estCommissionPerUnitPaise: number;
  calcReason: CalcReason;
  ruleId: string | null;
  ruleVersion: number | null;
}

export type QuoteLineResult = { ok: true; value: QuoteLinePrice } | { ok: false; error: string };

// The partner's own floor for a line: the rule's SKU minimum plus the
// add-ons (sold at face value), never above the listed price itself.
export function partnerFloorPaise(rule: CommissionRuleLike | null, listedUnitPaise: number, configCostPaise: number): number | null {
  if (!rule || rule.kind !== "margin_share" || rule.minimumPricePaise === null || rule.minimumPricePaise === undefined) return null;
  return Math.min(listedUnitPaise, rule.minimumPricePaise + Math.max(0, configCostPaise));
}

export function priceQuoteLine(input: QuoteLineInput): QuoteLineResult {
  const { listedUnitPaise, configCostPaise, quotedUnitPaise, quantity, rule } = input;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) return { ok: false, error: "Quantity must be 1-5" };
  if (!Number.isSafeInteger(quotedUnitPaise) || quotedUnitPaise <= 0) return { ok: false, error: "Enter a price" };
  // Orders are charged in whole rupees (Order.items[].finalPrice is rupees).
  if (quotedUnitPaise % 100 !== 0) return { ok: false, error: "Use a whole-rupee price" };
  if (quotedUnitPaise > listedUnitPaise) return { ok: false, error: "A quotation can't be above the listed price" };

  const floor = partnerFloorPaise(rule, listedUnitPaise, configCostPaise);
  let level: PricingLevel;
  if (quotedUnitPaise === listedUnitPaise) level = 1;
  else if (floor !== null && quotedUnitPaise >= floor) level = 2;
  else level = 3;

  const unit = commissionPerUnit(rule, quotedUnitPaise, configCostPaise);
  return {
    ok: true,
    value: {
      level,
      floorUnitPaise: floor,
      discountUnitPaise: listedUnitPaise - quotedUnitPaise,
      estCommissionPerUnitPaise: unit.perUnitPaise,
      calcReason: unit.reason,
      ruleId: rule?._id ? String(rule._id) : null,
      ruleVersion: rule?.version ?? null,
    },
  };
}

export interface QuoteTotalsLine {
  listedUnitPaise: number;
  quotedUnitPaise: number;
  quantity: number;
  estCommissionPerUnitPaise: number;
  approvedCommissionPerUnitPaise?: number | null;
}

export function quoteTotals(lines: QuoteTotalsLine[]) {
  let listedPaise = 0;
  let quotedPaise = 0;
  let estCommissionPaise = 0;
  for (const l of lines) {
    listedPaise += l.listedUnitPaise * l.quantity;
    quotedPaise += l.quotedUnitPaise * l.quantity;
    const per = l.approvedCommissionPerUnitPaise ?? l.estCommissionPerUnitPaise;
    estCommissionPaise += per * l.quantity;
  }
  return { listedPaise, quotedPaise, discountPaise: listedPaise - quotedPaise, estCommissionPaise };
}

// Same flat rule as orderController (SHIPPING_THRESHOLD/SHIPPING_FLAT_RATE):
// free above ₹10,000 item subtotal, else ₹500. Display only — createOrder
// is what charges it.
export function quoteShippingPaise(quotedPaise: number): number {
  return quotedPaise > 1_000_000 ? 0 : 50_000;
}
