// DB-side quotation helpers: build priced lines from live products + rules,
// the customer-facing view, and the checkout price lock used by createOrder.
// Pricing maths lives in quotePricing.ts (pure, unit-tested).
import crypto from "crypto";
import mongoose, { Types } from "mongoose";
import Product from "../../models/Product";
import AmbassadorCommissionRule from "../models/AmbassadorCommissionRule";
import AmbassadorQuotation, { IAmbassadorQuotation } from "../models/AmbassadorQuotation";
import AmbassadorProfile from "../models/AmbassadorProfile";
import { calculateProductPrice } from "../../utils/pricing";
import { pickRule } from "./commissionCalc";
import { priceQuoteLine, quoteShippingPaise, quoteTotals } from "./quotePricing";
import { getSettings } from "./settings";
import { paiseToRupees, rupeesToPaise } from "../money";

export const newQuoteToken = () => crypto.randomBytes(24).toString("base64url");
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function formatQuoteNumber(seq: number): string {
  return `LSQ-${String(seq).padStart(6, "0")}`;
}

export type BuiltItems =
  | { ok: true; items: any[]; needsApproval: boolean; totals: ReturnType<typeof quoteTotals> }
  | { ok: false; errors: Record<string, string> };

// rawItems: [{ productId, quantity, unitPrice (rupees), config?: {ram, storage, warranty} }]
export async function buildQuoteItems(rawItems: unknown): Promise<BuiltItems> {
  if (!Array.isArray(rawItems) || rawItems.length < 1) return { ok: false, errors: { items: "Add at least one laptop" } };
  if (rawItems.length > 10) return { ok: false, errors: { items: "A quotation can have at most 10 lines" } };

  const errors: Record<string, string> = {};
  const ids = rawItems.map((i: any) => (mongoose.isValidObjectId(i?.productId) ? String(i.productId) : null));
  const products = await Product.find({ _id: { $in: ids.filter(Boolean) } }).lean();
  const byId = new Map(products.map((p: any) => [String(p._id), p]));
  const rules = await AmbassadorCommissionRule.find({ partnerType: "independent", status: "active" }).lean();
  const now = new Date();

  // Stock is checked against the total quantity per product across lines.
  const qtyByProduct = new Map<string, number>();
  rawItems.forEach((i: any, idx) => {
    const id = ids[idx];
    if (id && Number.isSafeInteger(i?.quantity)) qtyByProduct.set(id, (qtyByProduct.get(id) || 0) + i.quantity);
  });

  const items: any[] = [];
  rawItems.forEach((raw: any, idx) => {
    const key = `items.${idx}`;
    const id = ids[idx];
    const p: any = id ? byId.get(id) : null;
    if (!p) return void (errors[key] = "This laptop is no longer in the catalogue");
    if ((p.stock ?? 0) < (qtyByProduct.get(id!) || 0)) return void (errors[key] = p.stock > 0 ? `Only ${p.stock} in stock` : "Out of stock");

    const config: Record<string, string> = {};
    const labels: string[] = [];
    let configCost = 0;
    for (const k of ["ram", "storage", "warranty"] as const) {
      const v = raw?.config?.[k];
      if (v === undefined || v === null || v === "") continue;
      const opt = (p.configOptions?.[k] || []).find((o: any) => o.value === v);
      if (!opt) return void (errors[key] = `Unknown ${k} option`);
      config[k] = opt.value;
      labels.push(opt.label);
      configCost += opt.price || 0;
    }
    if (errors[key]) return;

    const listedRupees = calculateProductPrice(p.finalPrice, p.extraOffer).finalPrice + configCost;
    const unitPrice = typeof raw?.unitPrice === "number" && Number.isFinite(raw.unitPrice) ? raw.unitPrice : NaN;
    const rule: any = pickRule(rules as any[], "independent", id, now);
    const priced = priceQuoteLine({
      listedUnitPaise: rupeesToPaise(listedRupees),
      configCostPaise: rupeesToPaise(configCost),
      quotedUnitPaise: Number.isNaN(unitPrice) ? -1 : rupeesToPaise(unitPrice),
      quantity: raw?.quantity,
      rule,
    });
    if (!priced.ok) return void (errors[key] = priced.error);
    items.push({
      productId: p._id,
      title: p.title,
      slug: p.slug,
      image: p.image,
      config,
      configLabels: labels,
      configCostPaise: rupeesToPaise(configCost),
      listedUnitPaise: rupeesToPaise(listedRupees),
      floorUnitPaise: priced.value.floorUnitPaise,
      quotedUnitPaise: rupeesToPaise(unitPrice),
      quantity: raw.quantity,
      level: priced.value.level,
      estCommissionPerUnitPaise: priced.value.estCommissionPerUnitPaise,
      calcReason: priced.value.calcReason,
      ruleId: rule?._id || null,
      ruleVersion: rule?.version ?? null,
      approvedCommissionPerUnitPaise: null,
    });
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, items, needsApproval: items.some((i) => i.level === 3), totals: quoteTotals(items) };
}

export function displayStatus(q: { status: string; validUntil?: Date | null }, now = new Date()): string {
  if (q.status === "active" && q.validUntil && new Date(q.validUntil) <= now) return "expired";
  return q.status;
}

const R = paiseToRupees;

// Partner's own view: includes their floor, pricing level and estimate.
export function toPartnerQuoteView(q: any, opts: { shareBaseUrl?: string } = {}) {
  return {
    _id: q._id,
    quoteNumber: q.quoteNumber,
    version: q.version,
    rootId: q.rootId,
    leadId: q.leadId,
    customer: q.customer,
    customerNote: q.customerNote,
    status: displayStatus(q),
    validUntil: q.validUntil,
    createdAt: q.createdAt,
    convertedOrderNumber: q.convertedOrderNumber,
    items: q.items.map((i: any) => ({
      _id: i._id,
      productId: i.productId,
      title: i.title,
      image: i.image,
      slug: i.slug,
      config: i.config,
      configLabels: i.configLabels,
      quantity: i.quantity,
      listedUnitPrice: R(i.listedUnitPaise),
      floorUnitPrice: i.floorUnitPaise === null ? null : R(i.floorUnitPaise),
      quotedUnitPrice: R(i.quotedUnitPaise),
      level: i.level,
      estCommissionPerUnit: R(i.approvedCommissionPerUnitPaise ?? i.estCommissionPerUnitPaise),
      commissionApproved: i.approvedCommissionPerUnitPaise !== null && i.approvedCommissionPerUnitPaise !== undefined,
    })),
    totals: {
      listed: R(q.totals.listedPaise),
      quoted: R(q.totals.quotedPaise),
      discount: R(q.totals.discountPaise),
      estCommission: R(q.totals.estCommissionPaise),
      shipping: R(quoteShippingPaise(q.totals.quotedPaise)),
    },
    shareUrl: q.token && opts.shareBaseUrl && displayStatus(q) === "active" ? `${opts.shareBaseUrl.replace(/\/+$/, "")}/quote/${q.token}` : null,
  };
}

// Customer's view (public link): no floor, level, rule or commission; the
// partner is identified only by first name and partner code.
export function toPublicQuoteView(q: any, partner: { fullName?: string; partnerCode?: string } | null) {
  const status = displayStatus(q);
  return {
    quoteNumber: q.quoteNumber,
    version: q.version,
    status,
    validUntil: q.validUntil,
    createdAt: q.createdAt,
    customer: { name: q.customer.name },
    customerNote: q.customerNote,
    preparedBy: partner ? { firstName: String(partner.fullName || "").split(/\s+/)[0] || "Partner", partnerCode: partner.partnerCode } : null,
    items: q.items.map((i: any) => ({
      productId: i.productId,
      title: i.title,
      image: i.image,
      slug: i.slug,
      config: i.config,
      configLabels: i.configLabels,
      quantity: i.quantity,
      listedUnitPrice: R(i.listedUnitPaise),
      unitPrice: R(i.quotedUnitPaise),
    })),
    totals: {
      listed: R(q.totals.listedPaise),
      total: R(q.totals.quotedPaise),
      savings: R(q.totals.discountPaise),
      shipping: R(quoteShippingPaise(q.totals.quotedPaise)),
    },
    terms: [
      "Prices are subject to stock confirmation and final order acceptance by Lapshark.",
      "Payment is made only to Lapshark through the Lapshark checkout. Never pay a partner directly.",
      "Invoice, delivery, warranty and after-sales support are provided by Lapshark.",
    ],
  };
}

// ---- Checkout price lock (called from orderController.createOrder) ------

export type CheckoutQuote =
  | { ok: true; quote: IAmbassadorQuotation; partner: { _id: Types.ObjectId; partnerCode: string } }
  | { ok: false; status: number; message: string };

// Loads an active, unexpired quotation for checkout and checks the cart
// matches it line for line (product, configuration, quantity).
export async function loadQuoteForCheckout(token: unknown, items: any[]): Promise<CheckoutQuote> {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return { ok: false, status: 400, message: "This quotation link is not valid." };
  const settings = await getSettings();
  if (!settings.programmeEnabled) return { ok: false, status: 409, message: "This quotation can no longer be used. Please check out at the listed price." };
  const quote = await AmbassadorQuotation.findOne({ token }).select("+token");
  if (!quote) return { ok: false, status: 404, message: "This quotation link is not valid." };
  const status = displayStatus(quote);
  if (status !== "active") {
    const msg: Record<string, string> = {
      expired: "This quotation has expired. Ask your Lapshark partner for a fresh one.",
      superseded: "This quotation was updated. Ask your Lapshark partner for the latest link.",
      converted: "This quotation has already been used for an order.",
      pending_approval: "This quotation is still waiting for Lapshark's approval.",
    };
    return { ok: false, status: 409, message: msg[status] || "This quotation can no longer be used." };
  }
  const partner = await AmbassadorProfile.findById(quote.ambassadorId).select("_id partnerCode status").lean();
  if (!partner || partner.status !== "active") return { ok: false, status: 409, message: "This quotation can no longer be used. Please check out at the listed price." };

  const norm = (v: unknown) => (typeof v === "string" && v ? v : "");
  const same =
    Array.isArray(items) &&
    items.length === quote.items.length &&
    quote.items.every((q, i) => {
      const it = items[i] || {};
      return (
        String(it.productId) === String(q.productId) &&
        it.quantity === q.quantity &&
        norm(it.config?.ram) === norm(q.config?.ram) &&
        norm(it.config?.storage) === norm(q.config?.storage) &&
        norm(it.config?.warranty) === norm(q.config?.warranty)
      );
    });
  if (!same) return { ok: false, status: 409, message: "Your checkout doesn't match the quotation. Open the quotation link again." };
  return { ok: true, quote, partner: { _id: partner._id, partnerCode: partner.partnerCode } };
}

// Paid order that came from a quotation → mark the quotation converted.
// Idempotent; called from syncOrderCommissions.
export async function markQuoteConverted(order: any): Promise<void> {
  const qid = order?.ambassadorQuote?.quotationId;
  if (!qid) return;
  const now = new Date();
  await AmbassadorQuotation.updateOne(
    { _id: qid, status: "active" },
    {
      $set: { status: "converted", convertedOrderId: order._id, convertedOrderNumber: order.orderId, convertedAt: now },
      $push: { statusHistory: { status: "converted", at: now, by: null, note: `order ${order.orderId} paid` } },
    }
  );
}
