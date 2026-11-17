// Dealer-facing endpoints. Spec: distribution/docs/13-dealer-channel.md.
import { Request, Response } from "express";
import { Types } from "mongoose";
import Product from "../../models/Product";
import { nextSeq } from "../../models/Counter";
import AmbassadorProfile from "../../ambassador/models/AmbassadorProfile";
import { encrypt, encryptionConfigured, hmac } from "../../ambassador/services/crypto";
import { normalizePhone, rupeesToPaise } from "../../ambassador/money";
import { audit } from "../../ambassador/services/audit";
import DealerProfile from "../models/DealerProfile";
import DealerPrice from "../models/DealerPrice";
import DealerOrder from "../models/DealerOrder";
import DealerUnit from "../models/DealerUnit";
import { getDealerSettings } from "../services/settings";
import { releaseStock, reserveStock } from "../services/stock";
import { dealerOrderView, dealerProfileView } from "../services/views";
import {
  CatalogueEntry,
  claimError,
  formatDealerCode,
  formatDealerOrderNumber,
  isPaymentMethod,
  priceDealerOrder,
  validateClaim,
  validateDealerRegistration,
  validateFulfilment,
} from "../logic";

const me = (req: Request) => (req as any).user;
const dealerOf = (req: Request) => (req as any).dealer;

export const getProgramme = async (_req: Request, res: Response) => {
  const s = await getDealerSettings();
  res.json({ enabled: s.enabled, registrationOpen: s.registrationOpen, agreementVersion: s.agreementVersion, claimWindowDays: s.claimWindowDays });
};

export const getProfile = async (req: Request, res: Response) => {
  const s = await getDealerSettings();
  const profile = await DealerProfile.findOne({ userId: me(req)._id }).lean();
  res.json({
    profile: dealerProfileView(profile),
    programme: { enabled: s.enabled, registrationOpen: s.registrationOpen, agreementVersion: s.agreementVersion, claimWindowDays: s.claimWindowDays },
  });
};

export const register = async (req: Request, res: Response) => {
  const s = await getDealerSettings();
  if (!s.enabled || !s.registrationOpen) return res.status(503).json({ message: "Dealer registration is not open yet" });
  const user = me(req);
  const phone = normalizePhone(user.mobile);
  if (!phone) return res.status(400).json({ message: "Your account needs a verified mobile number" });
  if (await DealerProfile.exists({ userId: user._id })) return res.status(409).json({ message: "You have already applied", code: "ALREADY_REGISTERED" });
  if (!encryptionConfigured()) {
    console.error("[dealer] AMBASSADOR_ENC_KEY / AMBASSADOR_HASH_KEY not configured, refusing registration");
    return res.status(503).json({ message: "Registration is temporarily unavailable" });
  }
  const v = validateDealerRegistration(req.body, { agreementVersion: s.agreementVersion });
  if (!v.ok) return res.status(400).json({ message: "Please correct the highlighted fields", errors: v.errors });
  const input = v.value;

  const gstinHash = input.gstin ? hmac("gstin:" + input.gstin) : undefined;
  const panHash = input.pan ? hmac("dealer-pan:" + input.pan) : undefined;
  if (gstinHash && (await DealerProfile.exists({ gstinHash }))) return res.status(409).json({ message: "This GSTIN is already registered", errors: { gstin: "Already registered" } });
  if (panHash && (await DealerProfile.exists({ panHash }))) return res.status(409).json({ message: "This PAN is already registered", errors: { pan: "Already registered" } });
  if (await DealerProfile.exists({ phone })) return res.status(409).json({ message: "This mobile number is already registered" });

  const now = new Date();
  const flags: { type: string; detail: string; at: Date }[] = [];
  const amb = await AmbassadorProfile.findOne({ userId: user._id }).select("partnerCode status").lean();
  if (amb && !["rejected", "terminated"].includes(amb.status)) {
    flags.push({ type: "also_ambassador", detail: `Also a sales ambassador (${amb.partnerCode}, ${amb.status})`, at: now });
  }
  try {
    const profile = await DealerProfile.create({
      userId: user._id,
      dealerCode: formatDealerCode(await nextSeq("dealer")),
      status: "applied",
      statusHistory: [{ status: "applied", at: now, by: user._id, reason: "self-registration" }],
      businessName: input.businessName,
      contactName: input.contactName,
      phone,
      email: input.email,
      address: input.address,
      ...(input.gstin ? { gstin: { encrypted: encrypt(input.gstin), last4: input.gstin.slice(-4) }, gstinHash } : {}),
      ...(input.pan ? { pan: { encrypted: encrypt(input.pan), last4: input.pan.slice(-4) }, panHash } : {}),
      agreement: { version: input.agreementVersion, acceptedAt: now, ip: req.ip, noWarrantyAcknowledged: true },
      flags,
    });
    await audit({ actor: user, action: "dealer.register", targetType: "DealerProfile", targetId: String(profile._id), meta: { dealerCode: profile.dealerCode } });
    return res.status(201).json({ profile: dealerProfileView(profile.toObject()) });
  } catch (err: any) {
    if (err?.code === 11000) return res.status(409).json({ message: "These details are already registered with another dealer account" });
    throw err;
  }
};

// Products a dealer can buy: an active dealer price and stock > 0.
async function loadCatalogue(onlyIds?: string[]) {
  const priceFilter: any = { active: true };
  if (onlyIds) priceFilter.productId = { $in: onlyIds.filter((id) => Types.ObjectId.isValid(id)) };
  const prices = await DealerPrice.find(priceFilter).lean();
  const products = await Product.find({ _id: { $in: prices.map((p) => p.productId) } })
    .select("title brand image condition stock finalPrice specs category slug")
    .lean();
  const byId = new Map(products.map((p: any) => [String(p._id), p]));
  const entries: (CatalogueEntry & { brand?: string; specs?: Record<string, string>; listedPricePaise: number; category?: string; slug?: string })[] = [];
  for (const price of prices) {
    const p: any = byId.get(String(price.productId));
    if (!p) continue;
    entries.push({
      productId: String(p._id),
      title: p.title,
      brand: p.brand,
      category: p.category,
      slug: p.slug,
      condition: p.condition,
      image: p.image,
      specs: p.specs || {},
      stock: Math.max(0, p.stock ?? 0),
      listedPricePaise: rupeesToPaise(p.finalPrice || 0),
      pricePaise: price.pricePaise,
      warranty: price.warranty?.months ? { months: price.warranty.months, pricePaise: price.warranty.pricePaise } : null,
    });
  }
  return entries;
}

export const getCatalogue = async (_req: Request, res: Response) => {
  const entries = (await loadCatalogue()).filter((e) => e.stock > 0).sort((a, b) => a.title.localeCompare(b.title));
  res.json({ products: entries });
};

export const createOrder = async (req: Request, res: Response) => {
  const dealer = dealerOf(req);
  const s = await getDealerSettings();
  const body = req.body || {};
  if (!isPaymentMethod(body.paymentMethod)) return res.status(400).json({ message: "Choose bank transfer or cash", errors: { paymentMethod: "Required" } });
  const f = validateFulfilment(body.fulfilment);
  if (!f.ok) return res.status(400).json({ message: "Please correct the delivery details", errors: f.errors });

  const ids = Array.isArray(body.items) ? body.items.map((i: any) => String(i?.productId || "")) : [];
  const catalogue = new Map((await loadCatalogue(ids)).map((e) => [e.productId, e]));
  const priced = priceDealerOrder(body.items, catalogue);
  if (!priced.ok) return res.status(400).json({ message: Object.values(priced.errors)[0], errors: priced.errors });
  const { lines, totalPaise } = priced.value;

  if (body.paymentMethod === "cash" && totalPaise >= s.cashLimitPaise) {
    return res.status(400).json({ message: `Cash isn't accepted for orders of ₹${(s.cashLimitPaise / 100).toLocaleString("en-IN")} or more. Choose bank transfer.` });
  }

  const reserved = await reserveStock(lines.map((l) => ({ productId: l.productId, quantity: l.quantity, title: l.title })));
  if (!reserved.ok) return res.status(409).json({ message: `${reserved.title} just went out of stock. Please update your order.` });

  const now = new Date();
  try {
    const order = await DealerOrder.create({
      orderNumber: formatDealerOrderNumber(await nextSeq("dealerOrder")),
      dealerId: dealer._id,
      dealerCode: dealer.dealerCode,
      businessName: dealer.businessName,
      lines: lines.map((l) => ({ ...l, productId: new Types.ObjectId(l.productId), serials: [] as string[] })),
      totalPaise,
      paidPaise: 0,
      paymentMethod: body.paymentMethod,
      payments: [],
      fulfilment: f.value,
      status: "placed",
      statusHistory: [{ status: "placed", at: now, by: me(req)._id }],
      stockReserved: true,
      dealerNote: typeof body.note === "string" ? body.note.trim().slice(0, 500) || undefined : undefined,
      claims: [],
    });
    await audit({ actor: me(req), action: "dealer.order.place", targetType: "DealerOrder", targetId: String(order._id), meta: { orderNumber: order.orderNumber, totalPaise } });
    return res.status(201).json({ order: dealerOrderView(order.toObject()), payment: paymentInstructions(s) });
  } catch (err) {
    // Order failed to save after stock was taken: put it back.
    for (const l of lines) await Product.updateOne({ _id: l.productId }, { $inc: { stock: l.quantity } });
    throw err;
  }
};

function paymentInstructions(s: { bankTransferInstructions: string; pickupInstructions: string; cashLimitPaise: number }) {
  return { bankTransfer: s.bankTransferInstructions || null, pickup: s.pickupInstructions || null, cashLimitPaise: s.cashLimitPaise };
}

export const listOrders = async (req: Request, res: Response) => {
  const orders = await DealerOrder.find({ dealerId: dealerOf(req)._id }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ orders: orders.map((o) => dealerOrderView(o)) });
};

async function ownOrder(req: Request) {
  if (!Types.ObjectId.isValid(req.params.id as string)) return null;
  return DealerOrder.findOne({ _id: req.params.id, dealerId: dealerOf(req)._id });
}

export const getOrder = async (req: Request, res: Response) => {
  const order = await ownOrder(req);
  if (!order) return res.status(404).json({ message: "Order not found" });
  const s = await getDealerSettings();
  const units = await DealerUnit.find({ dealerOrderId: order._id }).select("serial warrantyMonths warrantyUntil").lean();
  res.json({
    order: dealerOrderView(order.toObject()),
    payment: paymentInstructions(s),
    claimWindowDays: s.claimWindowDays,
    units: units.map((u) => ({ serial: u.serial, warrantyMonths: u.warrantyMonths, warrantyUntil: u.warrantyUntil || null })),
  });
};

// A dealer can cancel only an unpaid order that hasn't been packed.
export const cancelOrder = async (req: Request, res: Response) => {
  const order = await ownOrder(req);
  if (!order) return res.status(404).json({ message: "Order not found" });
  const now = new Date();
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: order._id, status: "placed", paidPaise: 0 },
    {
      $set: { status: "cancelled", cancelledAt: now, cancelReason: "Cancelled by dealer" },
      $push: { statusHistory: { status: "cancelled", at: now, by: me(req)._id, note: "Cancelled by dealer" } },
    },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: "This order can no longer be cancelled here. Please contact Lapshark." });
  await releaseStock(updated._id);
  await audit({ actor: me(req), action: "dealer.order.cancel", targetType: "DealerOrder", targetId: String(updated._id), meta: { by: "dealer" } });
  res.json({ order: dealerOrderView(updated.toObject()) });
};

export const createClaim = async (req: Request, res: Response) => {
  const order = await ownOrder(req);
  if (!order) return res.status(404).json({ message: "Order not found" });
  const v = validateClaim(req.body);
  if (!v.ok) return res.status(400).json({ message: Object.values(v.errors)[0], errors: v.errors });
  const { type, serial, description, evidenceUrl } = v.value;
  const unit = await DealerUnit.findOne({ dealerOrderId: order._id, serial }).lean();
  if (!unit) return res.status(400).json({ message: "That serial number isn't part of this order", errors: { serial: "Not in this order" } });
  const s = await getDealerSettings();
  const err = claimError({ type, deliveredAt: order.deliveredAt, now: new Date(), claimWindowDays: s.claimWindowDays, warrantyUntil: unit.warrantyUntil });
  if (err) return res.status(400).json({ message: err });
  const now = new Date();
  const updated = await DealerOrder.findOneAndUpdate(
    { _id: order._id, status: "delivered", claims: { $not: { $elemMatch: { serial, status: "open" } } } },
    { $push: { claims: { type, serial, description, evidenceUrl, status: "open", createdAt: now } } },
    { new: true }
  );
  if (!updated) return res.status(409).json({ message: "There is already an open claim for this laptop" });
  await audit({ actor: me(req), action: "dealer.claim.create", targetType: "DealerOrder", targetId: String(order._id), meta: { type, serial } });
  res.status(201).json({ order: dealerOrderView(updated.toObject()) });
};
