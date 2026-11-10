import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import AmbassadorProfile, { PartnerStatus } from "../models/AmbassadorProfile";
import AmbassadorLead from "../models/AmbassadorLead";
import AmbassadorLeadActivity from "../models/AmbassadorLeadActivity";
import AmbassadorCommission from "../models/AmbassadorCommission";
import AmbassadorCommissionRule from "../models/AmbassadorCommissionRule";
import AmbassadorSettings, { SETTINGS_DEFAULTS } from "../models/AmbassadorSettings";
import AmbassadorWaitlist from "../models/AmbassadorWaitlist";
import AmbassadorDiscountRequest from "../models/AmbassadorDiscountRequest";
import Order from "../../models/Order";
import Product from "../../models/Product";
import { audit } from "../services/audit";
import { calculateProductPrice } from "../../utils/pricing";
import { decrypt } from "../services/crypto";
import { clearSettingsCache, EDITABLE_SETTINGS, getSettings } from "../services/settings";
import { commissionPerUnit, ILLUSTRATIVE_REFERRAL_SLABS, pickRule, validateRuleShape } from "../services/commissionCalc";
import { reattributeOrder, reverseOrderCommissions, syncOrderCommissions } from "../services/orderHooks";
import { toAdminProfileView, toCommissionView, toRuleView } from "../services/views";
import { ruleBodyToPaise } from "../validation";
import { invalidatePublicCounts } from "./partnerController";
import { normalizePhone, paiseToRupees, rupeesToPaise } from "../money";

const me = (req: Request) => (req as any).user;
const page = (req: Request) => Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
const PAGE_SIZE = 50;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const reasonOf = (req: Request, required = true): string | null => {
  const r = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
  return r || (required ? null : "");
};
const badId = (res: Response) => res.status(404).json({ message: "Not found" });

// ---- Overview -----------------------------------------------------------

export const overview = async (_req: Request, res: Response) => {
  const [byStatus, byType, commissions, leads, top] = await Promise.all([
    AmbassadorProfile.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    AmbassadorProfile.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$partnerType", n: { $sum: 1 } } }]),
    AmbassadorCommission.aggregate([
      { $match: { superseded: false } },
      { $group: { _id: "$status", amount: { $sum: "$commissionPaise" }, revenue: { $sum: { $multiply: ["$unitSellingPricePaise", "$quantity"] } }, orders: { $addToSet: "$orderId" }, held: { $sum: { $cond: [{ $ne: ["$hold", null] }, 1, 0] } } } },
    ]),
    AmbassadorLead.aggregate([{ $group: { _id: null, total: { $sum: 1 }, qualified: { $sum: { $cond: [{ $in: ["$status", ["qualified", "quotation_sent", "negotiation", "won"]] }, 1, 0] } } } }]),
    AmbassadorCommission.aggregate([
      { $match: { superseded: false, status: { $ne: "reversed" } } },
      { $group: { _id: "$ambassadorId", revenue: { $sum: { $multiply: ["$unitSellingPricePaise", "$quantity"] } }, commission: { $sum: "$commissionPaise" }, units: { $sum: "$quantity" } } },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      { $lookup: { from: "ambassadorprofiles", localField: "_id", foreignField: "_id", as: "p" } },
      { $project: { revenue: 1, commission: 1, units: 1, partnerCode: { $first: "$p.partnerCode" }, fullName: { $first: "$p.fullName" } } },
    ]),
  ]);
  const st = Object.fromEntries(byStatus.map((s: any) => [s._id, s.n]));
  const cm = Object.fromEntries(commissions.map((c: any) => [c._id, c]));
  const live = ["pending", "delivery_confirmed", "eligible", "approved", "processing", "paid"];
  const sum = (keys: string[], f: "amount" | "revenue") => keys.reduce((s, k) => s + (cm[k]?.[f] || 0), 0);
  const settings = await getSettings();
  const pendingPriceApprovals = await AmbassadorDiscountRequest.countDocuments({ status: "pending" });
  res.json({
    pendingPriceApprovals,
    settings: { programmeEnabled: settings.programmeEnabled, registrationOpen: settings.registrationOpen },
    partners: {
      applications: Object.values(st).reduce((a: number, b: any) => a + b, 0),
      awaitingReview: (st.application_submitted || 0) + (st.verification_pending || 0),
      approved: (st.approved || 0) + (st.active || 0),
      active: st.active || 0,
      byStatus: st,
      activeByType: Object.fromEntries(byType.map((t: any) => [t._id, t.n])),
    },
    leads: leads[0] ? { total: leads[0].total, qualified: leads[0].qualified } : { total: 0, qualified: 0 },
    sales: {
      attributedOrders: new Set(live.flatMap((k) => (cm[k]?.orders || []).map(String))).size,
      revenue: paiseToRupees(sum(live, "revenue")),
    },
    commission: {
      liability: paiseToRupees(sum(["pending", "delivery_confirmed", "eligible", "approved", "processing"], "amount")),
      paid: paiseToRupees(sum(["paid"], "amount")),
      reversed: paiseToRupees(sum(["reversed"], "amount")),
      onHold: live.reduce((s, k) => s + (cm[k]?.held || 0), 0),
    },
    topPartners: top.map((t: any) => ({ ...t, revenue: paiseToRupees(t.revenue), commission: paiseToRupees(t.commission) })),
  });
};

// ---- Partners -----------------------------------------------------------

export const listPartners = async (req: Request, res: Response) => {
  const filter: any = {};
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.type === "string" && req.query.type) filter.partnerType = req.query.type;
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    const q = req.query.q.trim().slice(0, 60);
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ fullName: rx }, { email: rx }, { partnerCode: rx }, { city: rx }, { phone: new RegExp(escapeRegex(q.replace(/\D/g, "") || q)) }];
  }
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorProfile.find(filter).select("-pan.encrypted -payout.encrypted -panHash -payoutHash").sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorProfile.countDocuments(filter),
  ]);
  res.json({ partners: rows.map(toAdminProfileView), total, page: p, pageSize: PAGE_SIZE });
};

export const getPartner = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const p = await AmbassadorProfile.findById(req.params.id).lean();
  if (!p) return badId(res);
  const [leadCount, commissions] = await Promise.all([
    AmbassadorLead.countDocuments({ ambassadorId: p._id }),
    AmbassadorCommission.aggregate([{ $match: { ambassadorId: p._id, superseded: false } }, { $group: { _id: "$status", n: { $sum: 1 }, amount: { $sum: "$commissionPaise" } } }]),
  ]);
  const sharedPayoutWith = await AmbassadorProfile.find({ payoutHash: p.payoutHash, _id: { $ne: p._id } }).select("partnerCode fullName status").lean();
  res.json({
    partner: toAdminProfileView(p),
    stats: { leads: leadCount, commissions: commissions.map((c: any) => ({ status: c._id, count: c.n, amount: paiseToRupees(c.amount) })) },
    sharedPayoutWith,
  });
};

export const revealSensitive = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const p = await AmbassadorProfile.findById(req.params.id).lean();
  if (!p) return badId(res);
  const purpose = typeof req.body?.purpose === "string" ? req.body.purpose.trim().slice(0, 200) : "";
  if (!purpose) return res.status(400).json({ message: "State why you need to view these details", errors: { purpose: "Required" } });
  let pan: string, payout: any;
  try {
    pan = decrypt(p.pan.encrypted);
    const raw = decrypt(p.payout.encrypted);
    payout = p.payout.method === "upi" ? { method: "upi", upiId: raw } : { method: "bank", ...JSON.parse(raw) };
  } catch (err: any) {
    console.error("[ambassador] decrypt failed for", String(p._id), err.message);
    return res.status(500).json({ message: "Could not decrypt — check AMBASSADOR_ENC_KEY" });
  }
  await audit({ actor: me(req), action: "ambassador.sensitive.reveal", targetType: "AmbassadorProfile", targetId: String(p._id), meta: { purpose } });
  res.set("Cache-Control", "no-store");
  res.json({ pan, payout });
};

const TRANSITIONS: Record<string, { from: PartnerStatus[]; to: PartnerStatus; needsReason: boolean; holdCommissions?: boolean }> = {
  verification: { from: ["application_submitted"], to: "verification_pending", needsReason: false },
  approve: { from: ["application_submitted", "verification_pending"], to: "approved", needsReason: false },
  reject: { from: ["application_submitted", "verification_pending"], to: "rejected", needsReason: true },
  suspend: { from: ["approved", "active"], to: "suspended", needsReason: true, holdCommissions: true },
  reactivate: { from: ["suspended"], to: "active", needsReason: false },
  terminate: { from: ["application_submitted", "verification_pending", "approved", "active", "suspended"], to: "terminated", needsReason: true, holdCommissions: true },
};

export const changePartnerStatus = (action: keyof typeof TRANSITIONS) => async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const t = TRANSITIONS[action];
  const reason = reasonOf(req, t.needsReason);
  if (reason === null) return res.status(400).json({ message: "A reason is required", errors: { reason: "Required" } });

  const before = await AmbassadorProfile.findById(req.params.id).select("status partnerCode orientationCompletedAt").lean();
  if (!before) return badId(res);
  // Reactivating someone who never finished orientation returns them to approved.
  const to: PartnerStatus = action === "reactivate" && !before.orientationCompletedAt ? "approved" : t.to;
  const now = new Date();
  const set: any = { status: to };
  if (action === "approve" || action === "reject") Object.assign(set, { reviewedBy: me(req)._id, reviewedAt: now });
  if (action === "reject") set.rejectionReason = reason;
  if (action === "suspend" || action === "terminate") set.suspensionReason = reason;

  const updated = await AmbassadorProfile.findOneAndUpdate(
    { _id: before._id, status: { $in: t.from } },
    { $set: set, $push: { statusHistory: { status: to, at: now, by: me(req)._id, reason: reason || action } } },
    { new: true }
  ).lean();
  if (!updated) return res.status(409).json({ message: `Can't ${action} a partner who is ${before.status.replace(/_/g, " ")}` });
  invalidatePublicCounts();

  let held = 0;
  if (t.holdCommissions) {
    const r = await AmbassadorCommission.updateMany(
      { ambassadorId: before._id, superseded: false, status: { $in: ["pending", "delivery_confirmed", "eligible", "approved"] }, hold: null },
      { $set: { hold: { reason: "partner_not_active", detail: `partner ${to}`, at: now } }, $push: { holdHistory: { reason: "partner_not_active", detail: `partner ${to}`, at: now } } }
    );
    held = r.modifiedCount;
  }
  await audit({ actor: me(req), action: `ambassador.partner.${action}`, targetType: "AmbassadorProfile", targetId: String(before._id), before: { status: before.status }, after: { status: to }, meta: { reason, commissionsHeld: held } });
  // Partner notification (WhatsApp) waits on a Meta-approved template — decisions Q2.
  res.json({ partner: toAdminProfileView(updated), commissionsHeld: held });
};

// ---- Leads --------------------------------------------------------------

export const listAllLeads = async (req: Request, res: Response) => {
  const filter: any = {};
  if (typeof req.query.ambassadorId === "string" && mongoose.isValidObjectId(req.query.ambassadorId)) filter.ambassadorId = new Types.ObjectId(req.query.ambassadorId);
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    const q = req.query.q.trim().slice(0, 60);
    filter.$or = [{ customerName: new RegExp(escapeRegex(q), "i") }, { phone: new RegExp(escapeRegex(q.replace(/\D/g, "") || q)) }];
  }
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorLead.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate("ambassadorId", "partnerCode fullName").lean(),
    AmbassadorLead.countDocuments(filter),
  ]);
  res.json({
    leads: rows.map((l: any) => ({ ...l, budget: l.budgetPaise != null ? paiseToRupees(l.budgetPaise) : null, partner: l.ambassadorId, ambassadorId: l.ambassadorId?._id, ownershipActive: new Date(l.ownershipExpiresAt) > new Date() })),
    total,
    page: p,
    pageSize: PAGE_SIZE,
  });
};

export const adminUpdateLead = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ message: "A reason is required", errors: { reason: "Required" } });
  const lead = await AmbassadorLead.findById(req.params.id);
  if (!lead) return badId(res);
  const before = { ambassadorId: String(lead.ambassadorId), ownershipExpiresAt: lead.ownershipExpiresAt };

  if (req.body?.action === "reassign") {
    const to = req.body.toAmbassadorId;
    if (!mongoose.isValidObjectId(to)) return res.status(400).json({ message: "Choose a partner", errors: { toAmbassadorId: "Required" } });
    const target = await AmbassadorProfile.findOne({ _id: to, status: "active" }).select("_id partnerCode").lean();
    if (!target) return res.status(400).json({ message: "Target partner must be active" });
    if (String(target._id) === before.ambassadorId) return res.status(400).json({ message: "Lead already belongs to that partner" });
    lead.ambassadorId = target._id;
    await lead.save();
    await AmbassadorLeadActivity.create({ leadId: lead._id, actorId: me(req)._id, actorType: "staff", type: "reassigned", description: `Reassigned to ${target.partnerCode}: ${reason}`, metadata: { from: before.ambassadorId, to: String(target._id) } });
  } else if (req.body?.action === "extend") {
    const days = Number(req.body.days);
    if (!Number.isInteger(days) || days < 1 || days > 180) return res.status(400).json({ message: "Days must be 1-180", errors: { days: "1-180" } });
    const base = Math.max(Date.now(), lead.ownershipExpiresAt.getTime());
    lead.ownershipExpiresAt = new Date(base + days * 86400000);
    await lead.save();
    await AmbassadorLeadActivity.create({ leadId: lead._id, actorId: me(req)._id, actorType: "staff", type: "ownership_extended", description: `Ownership extended by ${days} days: ${reason}` });
  } else {
    return res.status(400).json({ message: "action must be reassign or extend" });
  }
  await audit({ actor: me(req), action: `ambassador.lead.${req.body.action}`, targetType: "AmbassadorLead", targetId: String(lead._id), before, after: { ambassadorId: String(lead.ambassadorId), ownershipExpiresAt: lead.ownershipExpiresAt }, meta: { reason } });
  res.json({ lead: lead.toObject() });
};

// ---- Commission rules ---------------------------------------------------

export const listRules = async (req: Request, res: Response) => {
  const filter: any = {};
  if (req.query.status === "active" || req.query.status === "retired") filter.status = req.query.status;
  if (req.query.partnerType === "referral" || req.query.partnerType === "independent") filter.partnerType = req.query.partnerType;
  const rules = await AmbassadorCommissionRule.find(filter).sort({ status: 1, partnerType: 1, productId: 1, version: -1 }).limit(500).populate("productId", "title brand finalPrice").lean();
  res.json({
    rules: rules.map((r: any) => ({ ...toRuleView({ ...r, productId: r.productId?._id ?? null }), product: r.productId ? { title: r.productId.title, brand: r.productId.brand, finalPrice: r.productId.finalPrice } : null })),
    template: { kind: "slab", partnerType: "referral", productId: null, slabs: ILLUSTRATIVE_REFERRAL_SLABS.map((s) => ({ minPrice: paiseToRupees(s.minPricePaise), maxPrice: s.maxPricePaise === null ? null : paiseToRupees(s.maxPricePaise), commission: paiseToRupees(s.commissionPaise) })), note: "Illustrative pilot rates from the programme spec — confirm before activating." },
  });
};

async function parseRuleBody(raw: any, res: Response) {
  const body = ruleBodyToPaise(raw);
  const errors = validateRuleShape(body as any);
  if (body.productId && !mongoose.isValidObjectId(body.productId)) errors.productId = "Invalid product";
  else if (body.productId && !(await Product.exists({ _id: body.productId }))) errors.productId = "Product not found";
  if (body.validFrom && Number.isNaN(body.validFrom.getTime())) errors.validFrom = "Invalid date";
  if (body.validUntil && Number.isNaN(body.validUntil.getTime())) errors.validUntil = "Invalid date";
  if (body.validFrom && body.validUntil && body.validUntil <= body.validFrom) errors.validUntil = "Must be after valid from";
  if (Object.keys(errors).length) {
    res.status(400).json({ message: "Please correct the rule", errors });
    return null;
  }
  return {
    partnerType: body.partnerType,
    productId: body.productId ? new Types.ObjectId(body.productId) : null,
    kind: body.kind,
    slabs: body.kind === "slab" ? body.slabs : [],
    minimumPricePaise: body.kind === "margin_share" ? body.minimumPricePaise : null,
    baseCommissionPaise: body.kind === "margin_share" ? body.baseCommissionPaise : null,
    marginSharePercent: body.kind === "margin_share" ? body.marginSharePercent : null,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    notes: body.notes,
  };
}

// Retire the active version for this key (if any) and insert the next one,
// atomically. The partial unique index backs this up under races.
async function insertNewVersion(data: any, actorId: Types.ObjectId) {
  const session = await mongoose.startSession();
  let created: any, retired: any = null;
  try {
    await session.withTransaction(async () => {
      const key = { partnerType: data.partnerType, productId: data.productId };
      const latest = await AmbassadorCommissionRule.findOne(key).sort({ version: -1 }).session(session).lean();
      retired = await AmbassadorCommissionRule.findOneAndUpdate(
        { ...key, status: "active" },
        { $set: { status: "retired", retiredAt: new Date(), retiredBy: actorId } },
        { new: true, session }
      ).lean();
      [created] = await AmbassadorCommissionRule.create([{ ...data, version: (latest?.version || 0) + 1, status: "active", createdBy: actorId }], { session });
    });
  } finally {
    await session.endSession();
  }
  return { created: created.toObject(), retired };
}

export const createRule = (req: Request, res: Response) => saveRule(req, res, req.body);

// GET /admin/laptop-minimums — every laptop in stock with its live listed
// price and the independent-partner minimum that applies to it (its own SKU
// rule, else the default rule, else none). Setting one = POST
// /admin/commission-rules with productId (versioned, audited) — owner
// decision D17: the admin sets a minimum per laptop.
export const laptopMinimums = async (req: Request, res: Response) => {
  const filter: any = req.query.all === "1" ? {} : { stock: { $gt: 0 } };
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    filter.title = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), "i");
  }
  const [products, rules] = await Promise.all([
    Product.find(filter).select("title brand finalPrice extraOffer stock").sort({ title: 1 }).limit(500).lean(),
    AmbassadorCommissionRule.find({ partnerType: "independent", status: "active" }).lean(),
  ]);
  const view = (r: any) =>
    r && r.kind === "margin_share"
      ? { _id: r._id, version: r.version, minimumPrice: paiseToRupees(r.minimumPricePaise), baseCommission: paiseToRupees(r.baseCommissionPaise), marginSharePercent: r.marginSharePercent, updatedAt: r.createdAt }
      : null;
  const def = rules.find((r: any) => !r.productId) || null;
  const bySku = new Map(rules.filter((r: any) => r.productId).map((r: any) => [String(r.productId), r]));
  const laptops = products.map((p: any) => {
    const sku = bySku.get(String(p._id)) || null;
    return {
      _id: p._id,
      title: p.title,
      brand: p.brand,
      stock: p.stock,
      listedPrice: calculateProductPrice(p.finalPrice, p.extraOffer).finalPrice,
      rule: view(sku),
      skuRuleKind: sku?.kind || null,
    };
  });
  res.json({ laptops, defaultRule: view(def), withoutMinimum: laptops.filter((l) => !l.rule).length });
};

async function saveRule(req: Request, res: Response, raw: any) {
  const data = await parseRuleBody(raw, res);
  if (!data) return;
  try {
    const { created, retired } = await insertNewVersion(data, me(req)._id);
    await audit({ actor: me(req), action: "ambassador.rule.create", targetType: "AmbassadorCommissionRule", targetId: String(created._id), before: retired ? toRuleView(retired) : null, after: toRuleView(created) });
    res.status(201).json({ rule: toRuleView(created), retired: retired ? toRuleView(retired) : null });
  } catch (err: any) {
    if (err?.code === 11000) return res.status(409).json({ message: "Another admin changed this rule at the same moment — refresh and try again" });
    throw err;
  }
}

// "Edit" = new version from the old one + changes.
export const updateRule = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const current = await AmbassadorCommissionRule.findById(req.params.id).lean();
  if (!current) return badId(res);
  if (current.status !== "active") return res.status(409).json({ message: "Only the active version can be changed" });
  const merged = { ...toRuleView(current), ...req.body, partnerType: current.partnerType, productId: current.productId ? String(current.productId) : null };
  return saveRule(req, res, merged);
};

export const retireRule = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const r = await AmbassadorCommissionRule.findOneAndUpdate({ _id: req.params.id, status: "active" }, { $set: { status: "retired", retiredAt: new Date(), retiredBy: me(req)._id } }, { new: true }).lean();
  if (!r) return res.status(409).json({ message: "Rule is not active" });
  await audit({ actor: me(req), action: "ambassador.rule.retire", targetType: "AmbassadorCommissionRule", targetId: String(r._id), before: { status: "active" }, after: { status: "retired" } });
  res.json({ rule: toRuleView(r) });
};

export const previewRule = async (req: Request, res: Response) => {
  const partnerType = req.body?.partnerType;
  if (partnerType !== "referral" && partnerType !== "independent") return res.status(400).json({ message: "partnerType required" });
  const price = Number(req.body?.sellingPrice);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "sellingPrice required" });
  const productId = mongoose.isValidObjectId(req.body?.productId) ? String(req.body.productId) : null;
  const rules = await AmbassadorCommissionRule.find({ partnerType, status: "active" }).lean();
  const rule: any = pickRule(rules as any[], partnerType, productId);
  const unit = commissionPerUnit(rule, rupeesToPaise(price));
  res.json({ rule: rule ? toRuleView(rule) : null, commission: paiseToRupees(unit.perUnitPaise), reason: unit.reason, needsReview: unit.needsReview });
};

// ---- Commissions --------------------------------------------------------

export const listAllCommissions = async (req: Request, res: Response) => {
  const filter: any = { superseded: false };
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.ambassadorId === "string" && mongoose.isValidObjectId(req.query.ambassadorId)) filter.ambassadorId = new Types.ObjectId(req.query.ambassadorId);
  if (req.query.hold === "1") filter.hold = { $ne: null };
  if (typeof req.query.order === "string" && req.query.order.trim()) filter.orderNumber = req.query.order.trim().slice(0, 40);
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorCommission.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).populate("ambassadorId", "partnerCode fullName").lean(),
    AmbassadorCommission.countDocuments(filter),
  ]);
  res.json({
    commissions: rows.map((c: any) => ({ ...toCommissionView({ ...c, ambassadorId: c.ambassadorId?._id }, { staff: true }), partner: c.ambassadorId })),
    total,
    page: p,
    pageSize: PAGE_SIZE,
  });
};

export const clearHold = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
  if (!note) return res.status(400).json({ message: "Add a note explaining why the hold is cleared", errors: { note: "Required" } });
  const c = await AmbassadorCommission.findOne({ _id: req.params.id, superseded: false });
  if (!c) return badId(res);
  if (!c.hold) return res.status(409).json({ message: "This commission is not on hold" });
  if (c.hold.reason === "partner_not_active") {
    const partner = await AmbassadorProfile.findById(c.ambassadorId).select("status").lean();
    if (partner?.status !== "active") return res.status(409).json({ message: "Reactivate the partner before clearing this hold" });
  }
  const before = c.hold;
  const now = new Date();
  const r = await AmbassadorCommission.updateOne(
    { _id: c._id, "hold.reason": before.reason },
    { $set: { hold: null }, $push: { holdHistory: { reason: before.reason, detail: before.detail, at: before.at, clearedAt: now, clearedBy: me(req)._id, note } } }
  );
  if (!r.modifiedCount) return res.status(409).json({ message: "The hold changed — refresh and try again" });
  await audit({ actor: me(req), action: "ambassador.commission.clear_hold", targetType: "AmbassadorCommission", targetId: String(c._id), before: { hold: before }, after: { hold: null }, meta: { note } });
  res.json({ ok: true });
};

export const reverseCommission = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const reason = reasonOf(req);
  if (!reason) return res.status(400).json({ message: "A reason is required", errors: { reason: "Required" } });
  const now = new Date();
  const updated = await AmbassadorCommission.findOneAndUpdate(
    { _id: req.params.id, superseded: false, status: { $in: ["pending", "delivery_confirmed", "eligible", "approved"] } },
    { $set: { status: "reversed", reversedAt: now, reversalReason: reason }, $push: { statusHistory: { status: "reversed", at: now, by: me(req)._id, reason } } },
    { new: false }
  ).lean();
  if (!updated) return res.status(409).json({ message: "Only unpaid commissions can be reversed here (paid ones need a ledger adjustment)" });
  await audit({ actor: me(req), action: "ambassador.commission.reverse", targetType: "AmbassadorCommission", targetId: String(updated._id), before: { status: updated.status }, after: { status: "reversed" }, meta: { reason } });
  res.json({ ok: true });
};

// ---- Attribution / reconcile -------------------------------------------

export const manualAttribution = async (req: Request, res: Response) => {
  const { orderId, ambassadorId, override } = req.body || {};
  const evidence = typeof req.body?.evidence === "string" ? req.body.evidence.trim().slice(0, 1000) : "";
  if (!evidence) return res.status(400).json({ message: "Describe the referral evidence", errors: { evidence: "Required" } });
  if (!mongoose.isValidObjectId(ambassadorId)) return res.status(400).json({ message: "Choose a partner", errors: { ambassadorId: "Required" } });
  // Accept either the Mongo id or the human order number (LS-…).
  const order = mongoose.isValidObjectId(orderId)
    ? await Order.findById(orderId).select("_id orderId").lean()
    : typeof orderId === "string" ? await Order.findOne({ orderId: orderId.trim() }).select("_id orderId").lean() : null;
  if (!order) return res.status(404).json({ message: "Order not found", errors: { orderId: "Not found" } });
  const partner = await AmbassadorProfile.findOne({ _id: ambassadorId, status: { $in: ["active", "approved"] } }).select("_id partnerCode").lean();
  if (!partner) return res.status(400).json({ message: "Partner must be approved or active" });

  const existing = await AmbassadorCommission.find({ orderId: order._id, superseded: false }).select("ambassadorId status").lean();
  if (existing.length && String(existing[0].ambassadorId) === String(partner._id)) return res.status(409).json({ message: "Order is already attributed to this partner" });
  if (existing.length && override !== true) {
    return res.status(409).json({ message: "This order is already attributed to another partner. Confirm override to re-attribute.", code: "ALREADY_ATTRIBUTED" });
  }
  const result = await reattributeOrder(order._id as Types.ObjectId, partner._id, evidence, me(req)._id);
  await audit({
    actor: me(req),
    action: "ambassador.attribution.manual",
    targetType: "Order",
    targetId: String(order._id),
    before: existing.length ? { ambassadorId: String(existing[0].ambassadorId) } : null,
    after: { ambassadorId: String(partner._id) },
    meta: { orderNumber: order.orderId, evidence, override: !!override, ...result },
  });
  res.json(result);
};

export const reconcile = async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(String(req.body?.sinceDays ?? 30), 10) || 30, 1), 180);
  const since = new Date(Date.now() - days * 86400000);
  const orders = await Order.find({ updatedAt: { $gte: since }, paymentStatus: { $in: ["Paid", "Refunded"] } }).select("_id").lean();
  const totals = { orders: orders.length, created: 0, delivered: 0, reversed: 0, errors: 0 };
  for (const o of orders) {
    try {
      const r = await syncOrderCommissions(o._id as Types.ObjectId);
      totals.created += r.created;
      totals.delivered += r.delivered;
      totals.reversed += r.reversed;
    } catch (err: any) {
      totals.errors++;
      console.error("[ambassador] reconcile failed for", String(o._id), err.message);
    }
  }
  await audit({ actor: me(req), action: "ambassador.reconcile", targetType: "Order", targetId: "*", meta: { sinceDays: days, ...totals } });
  res.json(totals);
};

// ---- Waitlist -----------------------------------------------------------

export const listWaitlist = async (req: Request, res: Response) => {
  const filter: any = {};
  if (req.query.status === "waiting" || req.query.status === "invited" || req.query.status === "registered") filter.status = req.query.status;
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorWaitlist.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorWaitlist.countDocuments(filter),
  ]);
  // Mark entries whose mobile has since applied, so the list stays honest.
  const applied = new Set((await AmbassadorProfile.find({ phone: { $in: rows.map((r) => r.phone) } }).select("phone").lean()).map((x) => x.phone));
  res.json({ entries: rows.map((r) => ({ ...r, applied: applied.has(r.phone) })), total, page: p, pageSize: PAGE_SIZE });
};

// Adds the mobile to the pilot allowlist so this person can register.
export const inviteFromWaitlist = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return badId(res);
  const entry = await AmbassadorWaitlist.findById(req.params.id);
  if (!entry) return badId(res);
  await AmbassadorSettings.updateOne({ key: "default" }, { $addToSet: { pilotAllowlist: entry.phone }, $set: { updatedBy: me(req)._id } }, { upsert: true });
  clearSettingsCache();
  const before = entry.status;
  if (entry.status === "waiting") {
    entry.status = "invited";
    entry.invitedAt = new Date();
    entry.invitedBy = me(req)._id;
    await entry.save();
  }
  await audit({ actor: me(req), action: "ambassador.waitlist.invite", targetType: "AmbassadorWaitlist", targetId: String(entry._id), before: { status: before }, after: { status: entry.status } });
  // No WhatsApp template for invites yet (decisions Q2) — staff contact the person.
  res.json({ entry: entry.toObject(), message: `Invited. ${entry.phone} can now apply at /partner/register. Let them know by phone or WhatsApp.` });
};

// ---- Settings -----------------------------------------------------------

export const getProgrammeSettings = async (_req: Request, res: Response) => {
  res.json({ settings: await getSettings(), defaults: SETTINGS_DEFAULTS });
};

export const updateProgrammeSettings = async (req: Request, res: Response) => {
  const b = req.body || {};
  const set: any = {};
  const errors: Record<string, string> = {};
  for (const k of EDITABLE_SETTINGS) {
    if (b[k] === undefined) continue;
    const v = b[k];
    switch (k) {
      case "programmeEnabled":
      case "registrationOpen":
        if (typeof v !== "boolean") errors[k] = "true/false";
        else set[k] = v;
        break;
      case "pilotAllowlist": {
        if (!Array.isArray(v)) { errors[k] = "list of mobile numbers"; break; }
        const phones = v.map(normalizePhone);
        if (phones.some((p: string | null) => !p)) errors[k] = "every entry must be a valid 10-digit mobile";
        else set[k] = Array.from(new Set(phones));
        break;
      }
      case "agreementVersion":
      case "referralBaseUrl":
        if (typeof v !== "string" || !v.trim()) errors[k] = "required";
        else if (k === "referralBaseUrl" && !/^https:\/\/[^\s]+$/.test(v.trim())) errors[k] = "must be an https URL";
        else set[k] = v.trim().slice(0, 200);
        break;
      case "tdsPercent": {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 30 || Math.round(n * 100) !== n * 100) errors[k] = "0-30, up to 2 decimals";
        else set[k] = n;
        break;
      }
      default: {
        const n = Number(v);
        const bounds: Record<string, [number, number]> = { leadOwnershipDays: [1, 365], eligibilityHoldDays: [0, 90], quotationValidityHours: [1, 720], minimumAge: [18, 100], foundingCohortSize: [0, 10000] };
        const [lo, hi] = bounds[k];
        if (!Number.isInteger(n) || n < lo || n > hi) errors[k] = `whole number ${lo}-${hi}`;
        else set[k] = n;
      }
    }
  }
  if (Object.keys(errors).length) return res.status(400).json({ message: "Please correct the settings", errors });
  if (!Object.keys(set).length) return res.status(400).json({ message: "Nothing to update" });
  const before = await getSettings();
  const after = await AmbassadorSettings.findOneAndUpdate({ key: "default" }, { $set: { ...set, updatedBy: me(req)._id } }, { new: true, upsert: true }).lean();
  clearSettingsCache();
  const changedBefore = Object.fromEntries(Object.keys(set).map((k) => [k, (before as any)[k]]));
  await audit({ actor: me(req), action: "ambassador.settings.update", targetType: "AmbassadorSettings", targetId: "default", before: changedBefore, after: set });
  res.json({ settings: after });
};
