// Admin endpoints for the dealer channel. Every privileged action is audited
// ("dealer.*" in the existing AuditLog). Staff roles: see dealer/routes.ts.
import { Request, Response } from "express";
import { Types } from "mongoose";
import Product from "../../models/Product";
import Order from "../../models/Order";
import { decrypt } from "../../ambassador/services/crypto";
import { rupeesToPaise } from "../../ambassador/money";
import { audit } from "../../ambassador/services/audit";
import DealerProfile, { DealerStatus } from "../models/DealerProfile";
import DealerPrice from "../models/DealerPrice";
import DealerOrder, { CLAIM_STATUSES, DEALER_ORDER_STATUSES } from "../models/DealerOrder";
import DealerUnit from "../models/DealerUnit";
import DealerSettings, { DEALER_SETTINGS_DEFAULTS, EDITABLE_DEALER_SETTINGS } from "../models/DealerSettings";
import { clearDealerSettingsCache, getDealerSettings } from "../services/settings";
import { releaseStock } from "../services/stock";
import { adminDealerView, dealerOrderView } from "../services/views";
import { addMonths, cashLimitError, istDayRange, normalizeDealerSerial, validatePayment, validatePriceInput, validateSerials } from "../logic";

const me = (req: Request) => (req as any).user;
const idOk = (id: unknown) => typeof id === "string" && Types.ObjectId.isValid(id);
const text = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- Overview ----
export const overview = async (_req: Request, res: Response) => {
  const [applied, approved, byStatus, openClaims] = await Promise.all([
    DealerProfile.countDocuments({ status: "applied" }),
    DealerProfile.countDocuments({ status: "approved" }),
    DealerOrder.aggregate([{ $group: { _id: "$status", count: { $sum: 1 }, totalPaise: { $sum: "$totalPaise" } } }]),
    DealerOrder.aggregate([{ $unwind: "$claims" }, { $match: { "claims.status": "open" } }, { $count: "n" }]),
  ]);
  const orders: Record<string, { count: number; totalPaise: number }> = {};
  for (const s of DEALER_ORDER_STATUSES) orders[s] = { count: 0, totalPaise: 0 };
  for (const r of byStatus) orders[r._id] = { count: r.count, totalPaise: r.totalPaise };
  res.json({ dealers: { applied, approved }, orders, openClaims: openClaims[0]?.n || 0 });
};

// ---- Dealers ----
export const listDealers = async (req: Request, res: Response) => {
  const filter: any = {};
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ businessName: rx }, { contactName: rx }, { dealerCode: rx }, { phone: rx }, { "address.city": rx }];
  }
  const dealers = await DealerProfile.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  res.json({ dealers: dealers.map(adminDealerView) });
};

export const getDealer = async (req: Request, res: Response) => {
  if (!idOk(req.params.id)) return res.status(404).json({ message: "Dealer not found" });
  const d = await DealerProfile.findById(req.params.id).lean();
  if (!d) return res.status(404).json({ message: "Dealer not found" });
  const orders = await DealerOrder.find({ dealerId: d._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ dealer: adminDealerView(d), orders: orders.map((o) => dealerOrderView(o, { admin: true })) });
};

// Full GSTIN / PAN, audited (super admin + finance only).
export const revealDealer = async (req: Request, res: Response) => {
  if (!idOk(req.params.id)) return res.status(404).json({ message: "Dealer not found" });
  const d = await DealerProfile.findById(req.params.id).lean();
  if (!d) return res.status(404).json({ message: "Dealer not found" });
  await audit({ actor: me(req), action: "dealer.reveal", targetType: "DealerProfile", targetId: String(d._id), meta: { dealerCode: d.dealerCode } });
  res.json({ gstin: d.gstin?.encrypted ? decrypt(d.gstin.encrypted) : null, pan: d.pan?.encrypted ? decrypt(d.pan.encrypted) : null });
};

const STATUS_ACTIONS: Record<string, { to: DealerStatus; from: DealerStatus[]; needsReason: boolean }> = {
  approve: { to: "approved", from: ["applied", "rejected"], needsReason: false },
  reject: { to: "rejected", from: ["applied"], needsReason: true },
  suspend: { to: "suspended", from: ["approved"], needsReason: true },
  reactivate: { to: "approved", from: ["suspended"], needsReason: false },
};

export const changeDealerStatus = (action: keyof typeof STATUS_ACTIONS) => async (req: Request, res: Response) => {
  const a = STATUS_ACTIONS[action];
  if (!idOk(req.params.id)) return res.status(404).json({ message: "Dealer not found" });
  const reason = text(req.body?.reason);
  if (a.needsReason && !reason) return res.status(400).json({ message: "Enter a reason" });
  const now = new Date();
  const d = await DealerProfile.findOneAndUpdate(
    { _id: req.params.id, status: { $in: a.from } },
    { $set: { status: a.to }, $push: { statusHistory: { status: a.to, at: now, by: me(req)._id, reason: reason || undefined } } },
    { new: true }
  );
  if (!d) return res.status(409).json({ message: `This dealer can't be moved to ${a.to} from its current status` });
  await audit({ actor: me(req), action: `dealer.${action}`, targetType: "DealerProfile", targetId: String(d._id), meta: { dealerCode: d.dealerCode, reason } });
  res.json({ dealer: adminDealerView(d.toObject()) });
};

export const updateDealerNotes = async (req: Request, res: Response) => {
  if (!idOk(req.params.id)) return res.status(404).json({ message: "Dealer not found" });
  const d = await DealerProfile.findByIdAndUpdate(req.params.id, { $set: { notes: text(req.body?.notes, 2000) } }, { new: true });
  if (!d) return res.status(404).json({ message: "Dealer not found" });
  res.json({ dealer: adminDealerView(d.toObject()) });
};

// ---- Prices ----
// Every laptop listing with its retail price, stock and (if set) dealer price,
// so the admin sets trade prices next to the numbers they relate to.
export const listPrices = async (_req: Request, res: Response) => {
  const [products, prices] = await Promise.all([
    Product.find({}).select("title brand category condition stock finalPrice image").sort({ title: 1 }).lean(),
    DealerPrice.find({}).lean(),
  ]);
  const byProduct = new Map(prices.map((p) => [String(p.productId), p]));
  res.json({
    products: products.map((p: any) => {
      const dp = byProduct.get(String(p._id));
      return {
        productId: String(p._id),
        title: p.title,
        brand: p.brand,
        category: p.category,
        condition: p.condition,
        image: p.image,
        stock: p.stock ?? 0,
        listedPricePaise: rupeesToPaise(p.finalPrice || 0),
        dealerPrice: dp ? { pricePaise: dp.pricePaise, warranty: dp.warranty || null, active: dp.active, updatedAt: (dp as any).updatedAt } : null,
      };
    }),
  });
};

export const setPrice = async (req: Request, res: Response) => {
  const productId = req.params.productId;
  if (!idOk(productId)) return res.status(404).json({ message: "Laptop not found" });
  const product = await Product.findById(productId).select("title").lean();
  if (!product) return res.status(404).json({ message: "Laptop not found" });
  const v = validatePriceInput(req.body);
  if (!v.ok) return res.status(400).json({ message: Object.values(v.errors)[0], errors: v.errors });
  const now = new Date();
  const before = await DealerPrice.findOne({ productId }).lean();
  const after = await DealerPrice.findOneAndUpdate(
    { productId },
    {
      $set: { pricePaise: v.value.pricePaise, warranty: v.value.warranty, active: v.value.active, updatedBy: me(req)._id },
      $push: { history: { $each: [{ ...v.value, at: now, by: me(req)._id }], $slice: -50 } },
    },
    { upsert: true, new: true }
  );
  await audit({
    actor: me(req),
    action: "dealer.price.set",
    targetType: "DealerPrice",
    targetId: String(after!._id),
    before: before ? { pricePaise: before.pricePaise, warranty: before.warranty, active: before.active } : null,
    after: v.value,
    meta: { productId, title: (product as any).title },
  });
  res.json({ dealerPrice: { pricePaise: after!.pricePaise, warranty: after!.warranty || null, active: after!.active } });
};

// ---- Orders ----
export const listOrders = async (req: Request, res: Response) => {
  const filter: any = {};
  if (typeof req.query.status === "string" && req.query.status) {
    if (req.query.status === "open_claims") filter["claims.status"] = "open";
    else filter.status = req.query.status;
  }
  const orders = await DealerOrder.find(filter).sort({ createdAt: -1 }).limit(300).lean();
  res.json({ orders: orders.map((o) => dealerOrderView(o, { admin: true })) });
};

async function loadOrder(req: Request, res: Response) {
  if (!idOk(req.params.id)) {
    res.status(404).json({ message: "Order not found" });
    return null;
  }
  const o = await DealerOrder.findById(req.params.id);
  if (!o) res.status(404).json({ message: "Order not found" });
  return o;
}

export const getOrder = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  const units = await DealerUnit.find({ dealerOrderId: o._id }).select("serial warrantyMonths warrantyUntil lineId").lean();
  res.json({ order: dealerOrderView(o.toObject(), { admin: true }), units });
};

// Records money received by bank transfer (UTR) or cash (receipt number).
// The order becomes "paid" once payments cover the total. Cash is refused at
// or above the s.269ST limit, per order and per dealer per day.
export const recordPayment = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  if (o.status !== "placed") return res.status(409).json({ message: o.status === "cancelled" ? "This order is cancelled" : "This order is already fully paid" });
  const outstanding = o.totalPaise - o.paidPaise;
  const v = validatePayment(req.body, { outstandingPaise: outstanding });
  if (!v.ok) return res.status(400).json({ message: Object.values(v.errors)[0], errors: v.errors });
  const p = v.value;
  const s = await getDealerSettings();
  if (p.method === "cash") {
    const [start, end] = istDayRange(p.receivedAt);
    const agg = await DealerOrder.aggregate([
      { $match: { dealerId: o.dealerId } },
      { $unwind: "$payments" },
      { $match: { "payments.method": "cash", "payments.receivedAt": { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: "$payments.amountPaise" } } },
    ]);
    const err = cashLimitError({ orderTotalPaise: o.totalPaise, cashTodayPaise: agg[0]?.total || 0, amountPaise: p.amountPaise, limitPaise: s.cashLimitPaise });
    if (err) return res.status(400).json({ message: err });
  }
  const dupe = await DealerOrder.exists({ "payments.method": p.method, "payments.reference": p.reference });
  if (dupe) return res.status(409).json({ message: `Reference ${p.reference} is already recorded on an order` });

  const now = new Date();
  const fullyPaid = o.paidPaise + p.amountPaise === o.totalPaise;
  const update: any = {
    $push: { payments: { ...p, recordedBy: me(req)._id, recordedAt: now } },
    $inc: { paidPaise: p.amountPaise },
  };
  if (fullyPaid) {
    update.$set = { status: "paid", paidAt: now };
    update.$push.statusHistory = { status: "paid", at: now, by: me(req)._id, note: `${p.method === "cash" ? "Cash" : "Bank transfer"} ${p.reference}` };
  }
  // paidPaise in the filter: a concurrent payment on the same order makes this a no-op.
  const updated = await DealerOrder.findOneAndUpdate({ _id: o._id, status: "placed", paidPaise: o.paidPaise }, update, { new: true });
  if (!updated) return res.status(409).json({ message: "The order changed while saving. Please refresh and try again." });
  await audit({ actor: me(req), action: "dealer.payment.record", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, method: p.method, amountPaise: p.amountPaise, reference: p.reference } });
  res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
};

// Operations enter every unit's serial before the order can leave. Each
// serial is checked against the dealer register and retail orders.
export const recordSerials = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  if (o.status !== "paid") return res.status(409).json({ message: o.status === "placed" ? "Record the full payment before packing" : `Serials can't be entered on a ${o.status} order` });
  const v = validateSerials(o.lines.map((l) => ({ _id: String(l._id), quantity: l.quantity, title: l.title })), req.body?.lines);
  if (!v.ok) return res.status(400).json({ message: Object.values(v.errors)[0], errors: v.errors });
  const all = [...v.value.values()].flat();

  const taken = await DealerUnit.find({ serial: { $in: all } }).select("serial orderNumber").lean();
  if (taken.length) return res.status(409).json({ message: `Serial ${taken[0].serial} is already sold on ${taken[0].orderNumber}` });
  const retail = await Order.findOne({ "items.serialNumber": { $in: all.map((x) => new RegExp(`^\\s*${escapeRegex(x)}\\s*$`, "i")) } }).select("orderId items.serialNumber").lean();
  if (retail) return res.status(409).json({ message: `One of these serials is already on retail order ${(retail as any).orderId}` });

  const now = new Date();
  const units = o.lines.flatMap((l) =>
    (v.value.get(String(l._id)) || []).map((serial) => ({
      serial,
      productId: l.productId,
      productTitle: l.title,
      dealerId: o.dealerId,
      dealerCode: o.dealerCode,
      dealerOrderId: o._id,
      orderNumber: o.orderNumber,
      lineId: l._id,
      warrantyMonths: l.warrantyMonths || 0,
      soldAt: now,
    }))
  );
  try {
    await DealerUnit.insertMany(units, { ordered: true });
  } catch (err: any) {
    await DealerUnit.deleteMany({ dealerOrderId: o._id });
    if (err?.code === 11000) return res.status(409).json({ message: "One of these serials was just recorded on another order" });
    throw err;
  }
  const set: any = { status: "packed", packedAt: now };
  o.lines.forEach((l, i) => (set[`lines.${i}.serials`] = v.value.get(String(l._id)) || []));
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: o._id, status: "paid" },
    { $set: set, $push: { statusHistory: { status: "packed", at: now, by: me(req)._id, note: `${all.length} serial(s) recorded` } } },
    { new: true }
  );
  if (!updated) {
    await DealerUnit.deleteMany({ dealerOrderId: o._id });
    return res.status(409).json({ message: "The order changed while saving. Please refresh and try again." });
  }
  await audit({ actor: me(req), action: "dealer.order.pack", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, serials: all } });
  res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
};

async function startWarranties(orderId: Types.ObjectId, deliveredAt: Date) {
  const units = await DealerUnit.find({ dealerOrderId: orderId, warrantyMonths: { $gt: 0 } }).select("_id warrantyMonths").lean();
  for (const u of units) await DealerUnit.updateOne({ _id: u._id }, { $set: { warrantyUntil: addMonths(deliveredAt, u.warrantyMonths) } });
}

// Courier: needs courier name + AWB, order becomes "dispatched".
// Pickup: needs who collected it, order becomes "delivered" at once.
export const dispatchOrder = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  if (o.status !== "packed") return res.status(409).json({ message: "Only packed orders can be dispatched" });
  const now = new Date();
  if (o.fulfilment.method === "courier") {
    const courier = text(req.body?.courier, 60);
    const awb = text(req.body?.awb, 60);
    if (!courier || !awb) return res.status(400).json({ message: "Enter the courier and AWB number" });
    const updated = await DealerOrder.findOneAndUpdate(
      { _id: o._id, status: "packed" },
      { $set: { status: "dispatched", dispatchedAt: now, "fulfilment.courier": courier, "fulfilment.awb": awb }, $push: { statusHistory: { status: "dispatched", at: now, by: me(req)._id, note: `${courier} ${awb}` } } },
      { new: true }
    );
    if (!updated) return res.status(409).json({ message: "The order changed while saving. Please refresh and try again." });
    await audit({ actor: me(req), action: "dealer.order.dispatch", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, courier, awb } });
    return res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
  }
  const handedTo = text(req.body?.handedTo, 120);
  if (!handedTo) return res.status(400).json({ message: "Enter who collected the laptops" });
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: o._id, status: "packed" },
    {
      $set: { status: "delivered", dispatchedAt: now, deliveredAt: now, "fulfilment.handedTo": handedTo },
      $push: { statusHistory: { status: "delivered", at: now, by: me(req)._id, note: `Collected by ${handedTo}` } },
    },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: "The order changed while saving. Please refresh and try again." });
  await startWarranties(o._id, now);
  await audit({ actor: me(req), action: "dealer.order.handover", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, handedTo } });
  res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
};

export const markDelivered = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  const now = new Date();
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: o._id, status: "dispatched" },
    { $set: { status: "delivered", deliveredAt: now }, $push: { statusHistory: { status: "delivered", at: now, by: me(req)._id } } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: "Only dispatched orders can be marked delivered" });
  await startWarranties(o._id, now);
  await audit({ actor: me(req), action: "dealer.order.deliver", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber } });
  res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
};

// Cancels an order before dispatch. Stock goes back and recorded serials are
// released. If money was received, a refund note is required (the refund
// itself is made outside the system).
export const cancelOrder = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  if (!["placed", "paid", "packed"].includes(o.status)) return res.status(409).json({ message: `A ${o.status} order can't be cancelled` });
  const reason = text(req.body?.reason);
  const refundNote = text(req.body?.refundNote);
  if (!reason) return res.status(400).json({ message: "Enter a reason" });
  if (o.paidPaise > 0 && !refundNote) return res.status(400).json({ message: "Money was received on this order. Note how it is being refunded." });
  const now = new Date();
  const set: any = { status: "cancelled", cancelledAt: now, cancelReason: reason };
  if (refundNote) set.refundNote = refundNote;
  o.lines.forEach((_l, i) => (set[`lines.${i}.serials`] = []));
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: o._id, status: o.status },
    { $set: set, $push: { statusHistory: { status: "cancelled", at: now, by: me(req)._id, note: reason } } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: "The order changed while saving. Please refresh and try again." });
  await DealerUnit.deleteMany({ dealerOrderId: o._id });
  await releaseStock(o._id);
  await audit({ actor: me(req), action: "dealer.order.cancel", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, reason, refundNote, paidPaise: o.paidPaise } });
  res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
};

// Optional: the number of an invoice raised outside this system.
export const setInvoiceRef = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  const number = text(req.body?.number, 60);
  const note = text(req.body?.note, 300);
  const updated = await DealerOrder.findByIdAndUpdate(o._id, { $set: { invoiceRef: { number: number || undefined, note: note || undefined, by: me(req)._id, at: new Date() } } }, { new: true });
  await audit({ actor: me(req), action: "dealer.order.invoice_ref", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, number } });
  res.json({ order: dealerOrderView(updated!.toObject(), { admin: true }) });
};

export const decideClaim = async (req: Request, res: Response) => {
  const o = await loadOrder(req, res);
  if (!o) return;
  const claimId = req.params.claimId;
  const status = req.body?.status;
  const note = text(req.body?.resolutionNote, 1000);
  if (!idOk(claimId)) return res.status(404).json({ message: "Claim not found" });
  if (!CLAIM_STATUSES.includes(status) || status === "open") return res.status(400).json({ message: "Choose replacement, credit note, repair or reject" });
  if (!note) return res.status(400).json({ message: "Enter a resolution note" });
  const now = new Date();
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: o._id, claims: { $elemMatch: { _id: claimId, status: "open" } } },
    { $set: { "claims.$.status": status, "claims.$.resolutionNote": note, "claims.$.decidedBy": me(req)._id, "claims.$.decidedAt": now } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: "This claim is not open" });
  await audit({ actor: me(req), action: "dealer.claim.decide", targetType: "DealerOrder", targetId: String(o._id), meta: { orderNumber: o.orderNumber, claimId, status, note } });
  res.json({ order: dealerOrderView(updated.toObject(), { admin: true }) });
};

// ---- Serial lookup (support) ----
export const lookupSerial = async (req: Request, res: Response) => {
  const serial = normalizeDealerSerial(req.params.serial);
  if (!serial) return res.status(400).json({ message: "Enter a serial number" });
  const unit = await DealerUnit.findOne({ serial }).lean();
  if (unit) {
    const dealer = await DealerProfile.findById(unit.dealerId).select("businessName phone address.city").lean();
    const now = Date.now();
    return res.json({
      serial,
      channel: "dealer",
      productTitle: unit.productTitle,
      orderNumber: unit.orderNumber,
      dealer: { dealerCode: unit.dealerCode, businessName: dealer?.businessName, phone: dealer?.phone, city: (dealer as any)?.address?.city },
      soldAt: unit.soldAt,
      warranty:
        unit.warrantyMonths > 0
          ? { months: unit.warrantyMonths, until: unit.warrantyUntil || null, active: unit.warrantyUntil ? unit.warrantyUntil.getTime() >= now : null, coveredParty: "dealer" }
          : null,
      summary:
        unit.warrantyMonths > 0
          ? `Sold to dealer ${unit.dealerCode}. Lapshark warranty covers the dealer only, not the dealer's customer.`
          : `Sold to dealer ${unit.dealerCode} without Lapshark warranty. The dealer's customer should contact the dealer.`,
    });
  }
  const order: any = await Order.findOne({ "items.serialNumber": new RegExp(`^\\s*${escapeRegex(serial)}\\s*$`, "i") })
    .select("orderId status createdAt items.serialNumber items.title items.warranty")
    .lean();
  if (order) {
    const item = (order.items || []).find((i: any) => (i.serialNumber || "").trim().toUpperCase() === serial);
    return res.json({ serial, channel: "retail", orderId: order.orderId, orderStatus: order.status, productTitle: item?.title, warranty: item?.warranty || null, soldAt: order.createdAt, summary: `Retail order ${order.orderId}` });
  }
  res.status(404).json({ message: "No sale found for this serial number" });
};

// ---- Settings ----
export const getSettings = async (_req: Request, res: Response) => {
  res.json({ settings: await getDealerSettings() });
};

export const updateSettings = async (req: Request, res: Response) => {
  const b = req.body || {};
  const set: any = {};
  const e: Record<string, string> = {};
  for (const k of EDITABLE_DEALER_SETTINGS) {
    if (b[k] === undefined) continue;
    const def = (DEALER_SETTINGS_DEFAULTS as any)[k];
    if (typeof def === "boolean") {
      if (typeof b[k] !== "boolean") e[k] = "Must be true or false";
      else set[k] = b[k];
    } else if (typeof def === "number") {
      if (!Number.isSafeInteger(b[k]) || b[k] < 0) e[k] = "Must be a whole number";
      else set[k] = b[k];
    } else {
      if (typeof b[k] !== "string") e[k] = "Must be text";
      else set[k] = b[k].trim().slice(0, k === "agreementVersion" ? 40 : 2000);
    }
  }
  if (set.claimWindowDays !== undefined && (set.claimWindowDays < 1 || set.claimWindowDays > 60)) e.claimWindowDays = "1 to 60 days";
  // The cash cap can be lowered but never raised above the legal limit.
  if (set.cashLimitPaise !== undefined && set.cashLimitPaise > DEALER_SETTINGS_DEFAULTS.cashLimitPaise) e.cashLimitPaise = "Can't be above ₹2,00,000";
  if (set.agreementVersion !== undefined && !set.agreementVersion) e.agreementVersion = "Required";
  if (Object.keys(e).length) return res.status(400).json({ message: Object.values(e)[0], errors: e });
  const before = await getDealerSettings();
  await DealerSettings.updateOne({ key: "default" }, { $set: { ...set, updatedBy: me(req)._id } }, { upsert: true });
  clearDealerSettingsCache();
  const after = await getDealerSettings();
  await audit({ actor: me(req), action: "dealer.settings.update", targetType: "DealerSettings", targetId: "default", before: pick(before, Object.keys(set)), after: set });
  res.json({ settings: after });
};

function pick(o: any, keys: string[]) {
  const r: any = {};
  for (const k of keys) r[k] = o[k];
  return r;
}
