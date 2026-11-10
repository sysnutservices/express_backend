// Bridges the existing order lifecycle to ambassador commissions.
//
// One entry point, syncOrderCommissions(orderId), looks at the order's
// CURRENT state and brings its commissions in line:
//   paid & not yet attributed  → decide attribution, create one line per item
//   delivered                  → pending → delivery_confirmed
//   cancelled / RTO / refunded → any unpaid line → reversed
// Every step is idempotent, so it is safe to call after any order change, to
// call twice, and to replay from POST /admin/partners/reconcile.
//
// orderController calls it via syncOrderCommissionsSafe(), which never
// throws — a commission problem must never fail a payment/delivery/cancel.
import mongoose, { Types } from "mongoose";
import Order from "../../models/Order";
import User from "../../models/User";
import AmbassadorProfile from "../models/AmbassadorProfile";
import AmbassadorLead from "../models/AmbassadorLead";
import AmbassadorLeadActivity from "../models/AmbassadorLeadActivity";
import AmbassadorCommission, { CommissionStatus } from "../models/AmbassadorCommission";
import AmbassadorCommissionRule from "../models/AmbassadorCommissionRule";
import { getSettings } from "./settings";
import { allocateSellingPrices, commissionPerUnit, pickRule } from "./commissionCalc";
import { Candidate, clampCapturedAt, decideAttribution, normalizePartnerCode } from "./attribution";
import { normalizePhone, rupeesToPaise } from "../money";
import AmbassadorQuotation from "../models/AmbassadorQuotation";
import { markQuoteConverted } from "./quoteService";
import { clawbackOrderCommissions } from "./payoutService";

const REVERSIBLE: CommissionStatus[] = ["pending", "delivery_confirmed", "eligible", "approved"];

// ---- createOrder: referral capture -------------------------------------

// Returns the value to store on order.ambassadorRef, or undefined. Never
// throws and never blocks checkout: a bad code is simply not recorded.
export async function resolveReferralForNewOrder(
  rawCode: unknown,
  rawCapturedAt: unknown,
  buyerUserId: string | null
): Promise<{ code: string; ambassadorId: Types.ObjectId; capturedAt: Date } | undefined> {
  try {
    const code = normalizePartnerCode(rawCode);
    if (!code) return undefined;
    const settings = await getSettings();
    if (!settings.programmeEnabled) return undefined;
    const partner = await AmbassadorProfile.findOne({ partnerCode: code, status: "active" }).select("_id userId").lean();
    if (!partner) return undefined;
    if (buyerUserId && String(partner.userId) === String(buyerUserId)) return undefined; // own link
    const now = new Date();
    return { code, ambassadorId: partner._id, capturedAt: clampCapturedAt(rawCapturedAt, now, settings.leadOwnershipDays) };
  } catch (err: any) {
    console.error("[ambassador] referral capture failed:", err.message);
    return undefined;
  }
}

// ---- sync ---------------------------------------------------------------

export interface SyncResult {
  created: number;
  delivered: number;
  reversed: number;
  attributedTo?: string;
  skipped?: string;
}

export async function syncOrderCommissions(orderId: Types.ObjectId | string): Promise<SyncResult> {
  const result: SyncResult = { created: 0, delivered: 0, reversed: 0 };
  const order: any = await Order.findById(orderId).lean();
  if (!order) return { ...result, skipped: "order_not_found" };

  const isReversed = order.status === "Cancelled" || order.status === "RTO" || order.paymentStatus === "Refunded";

  if (order.paymentStatus === "Paid" && !isReversed) {
    result.created = await ensureCommissionsForPaidOrder(order);
    await markQuoteConverted(order);
  }

  if (order.status === "Delivered" && !isReversed) {
    const deliveredAt = order.shipment?.deliveredAt || new Date();
    const r = await AmbassadorCommission.updateMany(
      { orderId: order._id, superseded: false, status: "pending" },
      {
        $set: { status: "delivery_confirmed", deliveredAt },
        $push: { statusHistory: { status: "delivery_confirmed", at: new Date(), by: null, reason: "order delivered" } },
      }
    );
    result.delivered = r.modifiedCount;
  }

  if (isReversed) {
    const reason = order.paymentStatus === "Refunded" ? "order refunded" : order.status === "RTO" ? "returned to origin" : "order cancelled";
    result.reversed = await reverseOrderCommissions(order._id, reason, null);
  }
  return result;
}

export function syncOrderCommissionsSafe(orderId: Types.ObjectId | string | undefined | null): void {
  if (!orderId) return;
  syncOrderCommissions(orderId).catch((err) => {
    console.error(`[ambassador] commission sync failed for order ${orderId}:`, err?.message || err);
  });
}

export async function reverseOrderCommissions(orderId: Types.ObjectId, reason: string, by: Types.ObjectId | null): Promise<number> {
  const r = await AmbassadorCommission.updateMany(
    { orderId, superseded: false, status: { $in: REVERSIBLE } },
    {
      $set: { status: "reversed", reversedAt: new Date(), reversalReason: reason },
      $push: { statusHistory: { status: "reversed", at: new Date(), by, reason } },
    }
  );
  // Lines already in a payout or paid are never edited: a negative
  // adjustment (clawback) nets them off the partner's next payout.
  const clawbacks = await clawbackOrderCommissions(orderId, reason);
  if (clawbacks) console.log(`[ambassador] order ${orderId} reversed after payout: ${clawbacks} clawback adjustment(s) created`);
  return r.modifiedCount;
}

// ---- attribution + creation --------------------------------------------

async function buyerPhones(order: any): Promise<{ phones: string[]; userIds: string[]; userMobile?: string }> {
  const phones = new Set<string>();
  let userMobile: string | undefined;
  if (order.userId) {
    const u = await User.findById(order.userId).select("mobile").lean<{ mobile?: string }>();
    const m = normalizePhone(u?.mobile);
    if (m) {
      phones.add(m);
      userMobile = m;
    }
  }
  const ship = normalizePhone(order.shippingAddress?.phone);
  if (ship) phones.add(ship);
  // Other accounts registered on the same phones count as the same buyer.
  const users = phones.size ? await User.find({ mobile: { $in: [...phones] } }).select("_id").lean() : [];
  const userIds = new Set(users.map((u: any) => String(u._id)));
  if (order.userId) userIds.add(String(order.userId));
  return { phones: [...phones], userIds: [...userIds], userMobile };
}

interface ForcedAttribution {
  ambassadorId: Types.ObjectId;
  evidence: string;
}

// Returns number of lines inserted. Exported for manual attribution.
export async function ensureCommissionsForPaidOrder(order: any, forced?: ForcedAttribution): Promise<number> {
  const existing = await AmbassadorCommission.exists({ orderId: order._id, superseded: false });
  if (existing) return 0;

  const settings = await getSettings();
  if (!forced && !settings.programmeEnabled) return 0;

  const orderCreatedAt: Date = new Date(order.createdAt);
  const buyer = await buyerPhones(order);

  // Candidates (active partners only)
  const candidates: Candidate[] = [];
  if (forced) {
    candidates.push({ ambassadorId: String(forced.ambassadorId), type: "manual", at: orderCreatedAt });
  } else {
    if (order.ambassadorRef?.ambassadorId) {
      candidates.push({
        ambassadorId: String(order.ambassadorRef.ambassadorId),
        type: "referral_link",
        at: new Date(order.ambassadorRef.capturedAt || orderCreatedAt),
        code: order.ambassadorRef.code,
      });
    }
    if (buyer.phones.length) {
      const leads = await AmbassadorLead.find({
        phone: { $in: buyer.phones },
        createdAt: { $lte: orderCreatedAt },
        ownershipExpiresAt: { $gt: orderCreatedAt },
        status: { $ne: "lost" },
      })
        .select("_id ambassadorId createdAt")
        .lean();
      for (const l of leads) candidates.push({ ambassadorId: String(l.ambassadorId), type: "lead", at: new Date(l.createdAt), leadId: String(l._id) });
    }
  }
  if (!candidates.length) return 0;

  const partnerIds = [...new Set(candidates.map((c) => c.ambassadorId))];
  const partnerDocs = await AmbassadorProfile.find({ _id: { $in: partnerIds } }).select("_id userId phone status partnerType").lean();
  const allowed = new Set(forced ? ["active", "approved"] : ["active"]);
  const activePartners = new Map(partnerDocs.filter((p) => allowed.has(p.status)).map((p) => [String(p._id), p]));
  const live = candidates.filter((c) => activePartners.has(c.ambassadorId));
  if (!live.length) return 0;

  const prior = await Order.findOne({
    _id: { $ne: order._id },
    userId: { $in: buyer.userIds.map((id) => new Types.ObjectId(id)) },
    paymentStatus: "Paid",
    status: { $nin: ["Cancelled", "RTO"] },
    createdAt: { $lt: orderCreatedAt },
  } as any)
    .sort({ createdAt: 1 })
    .select("createdAt")
    .lean<{ createdAt: Date }>();

  const decision = decideAttribution({
    candidates: live,
    partners: Object.fromEntries([...activePartners].map(([id, p]) => [id, { userId: String(p.userId), phone: p.phone }])),
    buyer: { userId: order.userId ? String(order.userId) : null, phones: buyer.phones },
    buyerFirstPriorPaidOrderAt: prior?.createdAt || null,
  });
  if (!decision) return 0;

  const partner = activePartners.get(decision.winner.ambassadorId)!;
  const rules = await AmbassadorCommissionRule.find({ partnerType: partner.partnerType, status: "active" }).lean();
  const now = new Date();

  const items: any[] = order.items || [];
  const prices = allocateSellingPrices(
    items.map((i) => ({ itemId: String(i._id), unitPricePaise: rupeesToPaise(i.finalPrice), quantity: i.quantity || 1 })),
    rupeesToPaise(order.couponValue || 0)
  );

  // Level 3 lines from a quotation carry the commission an admin approved
  // with the special price — only when the quotation's own partner wins.
  const approvedByQuoteItem = new Map<string, number>();
  if (order.ambassadorQuote?.quotationId) {
    const q: any = await AmbassadorQuotation.findById(order.ambassadorQuote.quotationId).select("ambassadorId items._id items.approvedCommissionPerUnitPaise").lean();
    if (q && String(q.ambassadorId) === String(partner._id)) {
      for (const qi of q.items || []) {
        if (qi.approvedCommissionPerUnitPaise !== null && qi.approvedCommissionPerUnitPaise !== undefined) approvedByQuoteItem.set(String(qi._id), qi.approvedCommissionPerUnitPaise);
      }
    }
  }

  const firstHold = decision.holds[0];
  const docs = items.map((item, idx) => {
    const price = prices[idx];
    const productId = item.productId ? String(item.productId) : null;
    const rule = pickRule(rules as any[], partner.partnerType, productId, now) as any;
    const approved = item.quoteItemId ? approvedByQuoteItem.get(String(item.quoteItemId)) : undefined;
    const unit =
      approved !== undefined
        ? { perUnitPaise: approved, reason: "special_approval" as const, needsReview: false }
        : commissionPerUnit(rule, price.unitSellingPricePaise, rupeesToPaise(item.configCost || 0));
    let hold: any = null;
    if (firstHold) hold = { reason: firstHold, detail: decision.holds.join(","), at: now };
    else if (unit.needsReview) hold = { reason: unit.reason === "below_floor" ? "below_floor" : "no_rule", detail: unit.reason, at: now };
    return {
      ambassadorId: partner._id,
      orderId: order._id,
      orderNumber: order.orderId,
      orderItemId: item._id,
      productId: item.productId,
      productTitle: item.title,
      quantity: price.quantity,
      unitSellingPricePaise: price.unitSellingPricePaise,
      commissionPaise: unit.perUnitPaise * price.quantity,
      currency: "INR",
      ruleId: rule?._id || null,
      ruleSnapshot: rule
        ? {
            _id: rule._id,
            kind: rule.kind,
            partnerType: rule.partnerType,
            productId: rule.productId,
            version: rule.version,
            slabs: rule.slabs,
            minimumPricePaise: rule.minimumPricePaise,
            baseCommissionPaise: rule.baseCommissionPaise,
            marginSharePercent: rule.marginSharePercent,
          }
        : null,
      calc: { perUnitPaise: unit.perUnitPaise, reason: unit.reason },
      attribution: {
        type: decision.winner.type,
        code: decision.winner.code,
        leadId: decision.winner.leadId ? new Types.ObjectId(decision.winner.leadId) : undefined,
        capturedAt: decision.winner.at,
        conflictWith: decision.conflictWith.map((id) => new Types.ObjectId(id)),
        evidence: forced?.evidence,
      },
      status: "pending",
      statusHistory: [{ status: "pending", at: now, by: null, reason: `attributed via ${decision.winner.type}` }],
      hold,
      holdHistory: hold ? [{ reason: hold.reason, detail: hold.detail, at: now }] : [],
      superseded: false,
    };
  });

  // All lines or none. Upsert-on-insert keyed by the unique (order, line)
  // index, so a concurrent duplicate sync is a harmless no-op.
  let inserted = 0;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      inserted = 0;
      for (const d of docs) {
        const r = await AmbassadorCommission.updateOne(
          { orderId: d.orderId, orderItemId: d.orderItemId, superseded: false },
          { $setOnInsert: d },
          { upsert: true, session }
        );
        inserted += r.upsertedCount;
      }
      if (decision.winner.type === "lead" && decision.winner.leadId) {
        const leadId = new Types.ObjectId(decision.winner.leadId);
        await AmbassadorLead.updateOne({ _id: leadId }, { $set: { status: "won", wonOrderId: order._id } }, { session });
        await AmbassadorLeadActivity.create(
          [{ leadId, actorType: "system", type: "order_matched", description: `Order ${order.orderId} placed and paid`, metadata: { orderId: order._id } }],
          { session }
        );
      }
    });
  } catch (err: any) {
    if (err?.code === 11000) return 0; // a concurrent sync won the race
    throw err;
  } finally {
    await session.endSession();
  }
  return inserted;
}

// Admin re-attribution: supersede the current lines (if any), then create
// fresh lines for the chosen partner. Caller audits.
export async function reattributeOrder(orderId: Types.ObjectId, ambassadorId: Types.ObjectId, evidence: string, by: Types.ObjectId): Promise<{ superseded: number; created: number }> {
  const order: any = await Order.findById(orderId).lean();
  if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
  if (order.paymentStatus !== "Paid") throw Object.assign(new Error("Only paid orders can be attributed"), { status: 400 });
  if (order.status === "Cancelled" || order.status === "RTO") throw Object.assign(new Error("Order is cancelled"), { status: 400 });

  const live = await AmbassadorCommission.find({ orderId, superseded: false }).select("status ambassadorId").lean();
  if (live.some((c) => c.status === "processing" || c.status === "paid")) {
    throw Object.assign(new Error("Commission already in payout — cannot re-attribute"), { status: 409 });
  }
  let superseded = 0;
  if (live.length) {
    const r = await AmbassadorCommission.updateMany(
      { orderId, superseded: false },
      {
        $set: { status: "reversed", reversedAt: new Date(), reversalReason: "reattributed", superseded: true },
        $push: { statusHistory: { status: "reversed", at: new Date(), by, reason: "reattributed by admin" } },
      }
    );
    superseded = r.modifiedCount;
  }
  const created = await ensureCommissionsForPaidOrder(order, { ambassadorId, evidence });
  // Bring the new lines up to the order's current state (e.g. delivered).
  await syncOrderCommissions(orderId);
  return { superseded, created };
}
