// Phase 2: quotations with controlled negotiation (independent partners),
// Level 3 discount requests, and the customer's public quotation link.
// Spec: distribution/docs/04-api.md, 06 §6.7, 01 "Pricing authority".
import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import AmbassadorQuotation from "../models/AmbassadorQuotation";
import AmbassadorDiscountRequest from "../models/AmbassadorDiscountRequest";
import AmbassadorLead from "../models/AmbassadorLead";
import AmbassadorLeadActivity from "../models/AmbassadorLeadActivity";
import AmbassadorProfile from "../models/AmbassadorProfile";
import Product from "../../models/Product";
import Order from "../../models/Order";
import User from "../../models/User";
import { nextSeq } from "../../models/Counter";
import { getSettings } from "../services/settings";
import { audit } from "../services/audit";
import { quoteTotals } from "../services/quotePricing";
import { buildQuoteItems, displayStatus, formatQuoteNumber, newQuoteToken, toPartnerQuoteView, toPublicQuoteView, TOKEN_RE } from "../services/quoteService";
import { normalizePhone, paiseToRupees, rupeesToPaise } from "../money";

const me = (req: Request) => (req as any).user;
const amb = (req: Request) => (req as any).ambassador;
const PAGE_SIZE = 25;
const page = (req: Request) => Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REVISABLE = ["active", "pending_approval", "rejected"];

async function shareBase() {
  return (await getSettings()).referralBaseUrl || "https://lapshark.com/";
}

// ---- lead linkage ---------------------------------------------------------

type LeadResult = { ok: true; lead: any; customer: { name: string; phone: string; email?: string; location?: string } } | { ok: false; status: number; body: any };

// A quotation always belongs to one of the partner's leads, so the 30-day
// first-come ownership rule (docs/07) also governs quotations: a partner
// can't quote a customer another partner registered first.
async function resolveLead(req: Request, b: any): Promise<LeadResult> {
  const a = amb(req);
  const now = new Date();
  const email = clip(b.customer?.email, 254)?.toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { ok: false, status: 400, body: { message: "Please correct the highlighted fields", errors: { "customer.email": "Enter a valid email" } } };
  const closed = (lead: any) =>
    lead.status === "won" ? { ok: false as const, status: 409, body: { message: "This lead already has a completed order. Add a new lead for a new sale." } } : null;

  if (b.leadId !== undefined && b.leadId !== null && b.leadId !== "") {
    if (!mongoose.isValidObjectId(b.leadId)) return { ok: false, status: 404, body: { message: "Lead not found" } };
    const lead = await AmbassadorLead.findOne({ _id: b.leadId, ambassadorId: a._id });
    if (!lead) return { ok: false, status: 404, body: { message: "Lead not found" } };
    const c = closed(lead);
    if (c) return c;
    if (lead.status === "lost") return { ok: false, status: 409, body: { message: "This lead is marked lost. Change its status first." } };
    if (new Date(lead.ownershipExpiresAt) <= now) return { ok: false, status: 409, body: { message: "Your 30-day ownership of this customer has ended. Add them as a new lead to quote again." } };
    return {
      ok: true,
      lead,
      customer: { name: clip(b.customer?.name, 100) || lead.customerName, phone: lead.phone, email: email || lead.email, location: clip(b.customer?.location, 120) || lead.location },
    };
  }

  const name = clip(b.customer?.name, 100);
  const phone = normalizePhone(b.customer?.phone) || "";
  const errors: Record<string, string> = {};
  if (!name || name.length < 2) errors["customer.name"] = "Enter the customer's name";
  if (!phone) errors["customer.phone"] = "Enter a valid 10-digit mobile number";
  if (Object.keys(errors).length) return { ok: false, status: 400, body: { message: "Please correct the highlighted fields", errors } };
  if (phone === a.phone) return { ok: false, status: 400, body: { message: "You can't quote yourself", errors: { "customer.phone": "This is your own number" } } };

  const owned = await AmbassadorLead.findOne({ phone, ownershipExpiresAt: { $gt: now }, status: { $ne: "lost" } });
  if (owned && String(owned.ambassadorId) !== String(a._id)) return { ok: false, status: 409, body: { message: "This customer is already registered with another partner" } };
  if (owned) {
    const c = closed(owned);
    if (c) return c;
    return { ok: true, lead: owned, customer: { name: name!, phone: phone!, email: email || owned.email, location: clip(b.customer?.location, 120) || owned.location } };
  }

  if (b.consent !== true) return { ok: false, status: 400, body: { message: "Please confirm the customer agreed to be contacted", errors: { consent: "Required" } } };
  const buyers = await User.find({ mobile: phone }).select("_id").lean();
  const existingCustomer = buyers.length
    ? !!(await Order.exists({ userId: { $in: buyers.map((u) => u._id) }, paymentStatus: "Paid", status: { $nin: ["Cancelled", "RTO"] } } as any))
    : false;
  const settings = await getSettings();
  const location = clip(b.customer?.location, 120);
  const lead = await AmbassadorLead.create({
    ambassadorId: a._id,
    customerName: name!,
    phone,
    email,
    location,
    customerType: "individual",
    source: "quotation",
    status: "new",
    consent: { given: true, at: now, method: "partner_declared" },
    ownershipExpiresAt: new Date(now.getTime() + settings.leadOwnershipDays * 86400000),
    existingCustomer,
  });
  await AmbassadorLeadActivity.create({ leadId: lead._id, actorId: me(req)._id, actorType: "ambassador", type: "created", description: "Lead created from a quotation" });
  return { ok: true, lead, customer: { name: name!, phone, email, location } };
}

async function noteOnLead(req: Request, leadId: Types.ObjectId, quote: any) {
  const lead = await AmbassadorLead.findById(leadId);
  if (!lead) return;
  if (["new", "contacted", "qualified"].includes(lead.status)) {
    await AmbassadorLead.updateOne({ _id: leadId }, { $set: { status: "quotation_sent" } });
  }
  const what = quote.status === "pending_approval" ? "submitted for special-price approval" : "created";
  await AmbassadorLeadActivity.create({
    leadId,
    actorId: me(req)._id,
    actorType: "ambassador",
    type: "quotation",
    description: `Quotation ${quote.quoteNumber} v${quote.version} ${what} (₹${paiseToRupees(quote.totals.quotedPaise).toLocaleString("en-IN")})`,
    metadata: { quotationId: quote._id },
  });
}

// ---- create / revise -------------------------------------------------------

async function insertQuoteVersion(opts: {
  req: Request;
  built: Extract<Awaited<ReturnType<typeof buildQuoteItems>>, { ok: true }>;
  previous?: any;
  quoteNumber: string;
  leadId: Types.ObjectId;
  customer: any;
  customerNote?: string;
  discountReason?: string;
}) {
  const { req, built, previous } = opts;
  const a = amb(req);
  const settings = await getSettings();
  const now = new Date();
  const _id = new Types.ObjectId();
  const items = built.items.map((i) => ({ ...i, _id: new Types.ObjectId() }));
  const status = built.needsApproval ? "pending_approval" : "active";
  const doc: any = {
    _id,
    quoteNumber: opts.quoteNumber,
    version: previous ? previous.version + 1 : 1,
    rootId: previous ? previous.rootId : _id,
    previousId: previous?._id,
    ambassadorId: a._id,
    leadId: opts.leadId,
    customer: opts.customer,
    items,
    totals: built.totals,
    customerNote: opts.customerNote,
    status,
    validUntil: status === "active" ? new Date(now.getTime() + settings.quotationValidityHours * 3600000) : null,
    token: newQuoteToken(),
    stockCheckedAt: now,
    statusHistory: [{ status, at: now, by: me(req)._id, note: previous ? `revised from v${previous.version}` : "created" }],
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (previous) {
        const r = await AmbassadorQuotation.updateOne(
          { _id: previous._id, status: { $in: REVISABLE }, supersededBy: { $exists: false } },
          { $set: { status: "superseded", supersededBy: _id }, $push: { statusHistory: { status: "superseded", at: now, by: me(req)._id, note: `replaced by v${doc.version}` } } },
          { session }
        );
        if (r.modifiedCount !== 1) throw Object.assign(new Error("This quotation was changed in the meantime. Reload and try again."), { status: 409 });
        await AmbassadorDiscountRequest.updateMany({ quotationId: previous._id, status: "pending" }, { $set: { status: "withdrawn" } }, { session });
      }
      if (built.needsApproval) {
        const dr = await AmbassadorDiscountRequest.create(
          [
            {
              quotationId: _id,
              quoteNumber: doc.quoteNumber,
              quoteVersion: doc.version,
              ambassadorId: a._id,
              reason: opts.discountReason,
              lines: items
                .filter((i) => i.level === 3)
                .map((i) => ({
                  itemId: i._id,
                  title: i.title,
                  quantity: i.quantity,
                  listedUnitPaise: i.listedUnitPaise,
                  floorUnitPaise: i.floorUnitPaise,
                  requestedUnitPaise: i.quotedUnitPaise,
                  estCommissionPerUnitPaise: i.estCommissionPerUnitPaise,
                  approvedCommissionPerUnitPaise: null,
                })),
            },
          ],
          { session }
        );
        doc.discountRequestId = dr[0]._id;
      }
      await AmbassadorQuotation.create([doc], { session });
    });
  } catch (err: any) {
    if (err?.code === 11000) throw Object.assign(new Error("This quotation was changed in the meantime. Reload and try again."), { status: 409 });
    throw err;
  } finally {
    await session.endSession();
  }
  return doc;
}

function validateMeta(b: any, needsApproval: boolean) {
  const errors: Record<string, string> = {};
  const customerNote = clip(b.customerNote, 1000);
  const discountReason = clip(b.discountReason, 1000);
  if (needsApproval && (!discountReason || discountReason.length < 10)) {
    errors.discountReason = "One or more prices are below your minimum. Explain why this customer needs a special price (at least 10 characters).";
  }
  return { errors, customerNote, discountReason };
}

// POST /partners/quotations/price — live pricing preview, nothing saved.
export const previewQuotation = async (req: Request, res: Response) => {
  const built = await buildQuoteItems(req.body?.items);
  if (!built.ok) return res.status(400).json({ message: "Please check the highlighted lines", errors: built.errors });
  const view = toPartnerQuoteView({ items: built.items, totals: built.totals, customer: null, status: "draft" });
  res.json({ items: view.items, totals: view.totals, needsApproval: built.needsApproval });
};

// POST /partners/quotations
export const createQuotation = async (req: Request, res: Response) => {
  const b = req.body || {};
  const built = await buildQuoteItems(b.items);
  if (!built.ok) return res.status(400).json({ message: "Please check the highlighted lines", errors: built.errors });
  const meta = validateMeta(b, built.needsApproval);
  if (Object.keys(meta.errors).length) return res.status(400).json({ message: "Please correct the highlighted fields", errors: meta.errors });
  const leadRes = await resolveLead(req, b);
  if (!leadRes.ok) return res.status(leadRes.status).json(leadRes.body);

  const quoteNumber = formatQuoteNumber(await nextSeq("ambassador_quote"));
  const doc = await insertQuoteVersion({ req, built, quoteNumber, leadId: leadRes.lead._id, customer: leadRes.customer, customerNote: meta.customerNote, discountReason: meta.discountReason });
  await noteOnLead(req, leadRes.lead._id, doc);
  res.status(201).json({ quotation: toPartnerQuoteView(doc, { shareBaseUrl: await shareBase() }) });
};

async function ownQuote(req: Request) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return AmbassadorQuotation.findOne({ _id: req.params.id, ambassadorId: amb(req)._id }).select("+token").lean();
}

// POST /partners/quotations/:id/revise — new version; the old link stops working.
export const reviseQuotation = async (req: Request, res: Response) => {
  const prev: any = await ownQuote(req);
  if (!prev) return res.status(404).json({ message: "Quotation not found" });
  if (!REVISABLE.includes(prev.status) || prev.supersededBy) {
    return res.status(409).json({ message: `A ${displayStatus(prev).replace(/_/g, " ")} quotation can't be revised` });
  }
  const b = req.body || {};
  const built = await buildQuoteItems(b.items);
  if (!built.ok) return res.status(400).json({ message: "Please check the highlighted lines", errors: built.errors });
  const meta = validateMeta(b, built.needsApproval);
  if (Object.keys(meta.errors).length) return res.status(400).json({ message: "Please correct the highlighted fields", errors: meta.errors });
  const lead = prev.leadId ? await AmbassadorLead.findById(prev.leadId).select("ownershipExpiresAt status").lean() : null;
  if (!lead || new Date(lead.ownershipExpiresAt) <= new Date()) {
    return res.status(409).json({ message: "Your 30-day ownership of this customer has ended. Add them as a new lead to quote again." });
  }
  const doc = await insertQuoteVersion({
    req,
    built,
    previous: prev,
    quoteNumber: prev.quoteNumber,
    leadId: prev.leadId,
    customer: prev.customer,
    customerNote: meta.customerNote ?? prev.customerNote,
    discountReason: meta.discountReason,
  });
  await noteOnLead(req, prev.leadId, doc);
  res.status(201).json({ quotation: toPartnerQuoteView(doc, { shareBaseUrl: await shareBase() }) });
};

// POST /partners/quotations/:id/cancel
export const cancelQuotation = async (req: Request, res: Response) => {
  const q: any = await ownQuote(req);
  if (!q) return res.status(404).json({ message: "Quotation not found" });
  const now = new Date();
  const r = await AmbassadorQuotation.updateOne(
    { _id: q._id, status: { $in: REVISABLE } },
    { $set: { status: "cancelled" }, $push: { statusHistory: { status: "cancelled", at: now, by: me(req)._id, note: clip(req.body?.reason, 300) } } }
  );
  if (r.modifiedCount !== 1) return res.status(409).json({ message: `A ${displayStatus(q).replace(/_/g, " ")} quotation can't be cancelled` });
  await AmbassadorDiscountRequest.updateMany({ quotationId: q._id, status: "pending" }, { $set: { status: "withdrawn" } });
  res.json({ ok: true });
};

// GET /partners/quotations
export const listQuotations = async (req: Request, res: Response) => {
  const filter: any = { ambassadorId: amb(req)._id };
  const now = new Date();
  const s = typeof req.query.status === "string" ? req.query.status : "";
  if (s === "expired") Object.assign(filter, { status: "active", validUntil: { $lte: now } });
  else if (s === "active") Object.assign(filter, { status: "active", validUntil: { $gt: now } });
  else if (s) filter.status = s;
  else filter.status = { $ne: "superseded" };
  if (typeof req.query.leadId === "string" && mongoose.isValidObjectId(req.query.leadId)) filter.leadId = req.query.leadId;
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorQuotation.find(filter).select("+token").sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorQuotation.countDocuments(filter),
  ]);
  const base = await shareBase();
  res.json({ quotations: rows.map((q) => toPartnerQuoteView(q, { shareBaseUrl: base })), total, page: p, pageSize: PAGE_SIZE });
};

// GET /partners/quotations/:id — with version history and approval state.
export const getQuotation = async (req: Request, res: Response) => {
  const q: any = await ownQuote(req);
  if (!q) return res.status(404).json({ message: "Quotation not found" });
  const [versions, dr] = await Promise.all([
    AmbassadorQuotation.find({ rootId: q.rootId, ambassadorId: amb(req)._id }).select("version status validUntil totals createdAt").sort({ version: -1 }).lean(),
    AmbassadorDiscountRequest.findOne({ quotationId: q._id }).lean(),
  ]);
  res.json({
    quotation: toPartnerQuoteView(q, { shareBaseUrl: await shareBase() }),
    versions: versions.map((v: any) => ({ _id: v._id, version: v.version, status: displayStatus(v), total: paiseToRupees(v.totals.quotedPaise), createdAt: v.createdAt })),
    discountRequest: dr ? { status: dr.status, reason: dr.reason, decisionNote: dr.decision?.note, decidedAt: dr.decision?.at } : null,
  });
};

// ---- public ---------------------------------------------------------------

// GET /quotes/:token — what the customer sees. No floor/commission data.
export const getPublicQuote = async (req: Request, res: Response) => {
  const token = String(req.params.token || "");
  if (!TOKEN_RE.test(token)) return res.status(404).json({ message: "Quotation not found" });
  const q: any = await AmbassadorQuotation.findOne({ token }).lean();
  if (!q) return res.status(404).json({ message: "Quotation not found" });
  const partner = await AmbassadorProfile.findById(q.ambassadorId).select("fullName partnerCode status").lean();
  const view: any = toPublicQuoteView(q, partner);
  if (view.status === "active" && partner?.status !== "active") view.status = "cancelled";
  res.json({ quotation: view });
};

// ---- admin ----------------------------------------------------------------

async function partnersById(ids: Types.ObjectId[]) {
  const docs = await AmbassadorProfile.find({ _id: { $in: ids } }).select("fullName partnerCode partnerType status").lean();
  return new Map(docs.map((p: any) => [String(p._id), { _id: p._id, fullName: p.fullName, partnerCode: p.partnerCode, partnerType: p.partnerType, status: p.status }]));
}

// GET /admin/partner-quotations
export const adminListQuotations = async (req: Request, res: Response) => {
  const filter: any = {};
  const now = new Date();
  const s = typeof req.query.status === "string" ? req.query.status : "";
  if (s === "expired") Object.assign(filter, { status: "active", validUntil: { $lte: now } });
  else if (s === "active") Object.assign(filter, { status: "active", validUntil: { $gt: now } });
  else if (s) filter.status = s;
  else filter.status = { $ne: "superseded" };
  if (typeof req.query.ambassadorId === "string" && mongoose.isValidObjectId(req.query.ambassadorId)) filter.ambassadorId = req.query.ambassadorId;
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), "i");
    filter.$or = [{ quoteNumber: rx }, { "customer.name": rx }];
  }
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorQuotation.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorQuotation.countDocuments(filter),
  ]);
  const partners = await partnersById(rows.map((r) => r.ambassadorId));
  res.json({
    quotations: rows.map((q) => ({ ...toPartnerQuoteView(q), customer: { ...q.customer }, partner: partners.get(String(q.ambassadorId)) || null })),
    total,
    page: p,
    pageSize: PAGE_SIZE,
  });
};

function drView(d: any, partner: any, quote: any) {
  return {
    _id: d._id,
    quotationId: d.quotationId,
    quoteNumber: d.quoteNumber,
    quoteVersion: d.quoteVersion,
    status: d.status,
    reason: d.reason,
    createdAt: d.createdAt,
    decision: d.decision ? { at: d.decision.at, note: d.decision.note } : null,
    partner,
    customer: quote ? { name: quote.customer?.name, location: quote.customer?.location } : null,
    quoteTotals: quote ? { listed: paiseToRupees(quote.totals.listedPaise), quoted: paiseToRupees(quote.totals.quotedPaise) } : null,
    lines: d.lines.map((l: any) => ({
      itemId: l.itemId,
      title: l.title,
      quantity: l.quantity,
      listedUnitPrice: paiseToRupees(l.listedUnitPaise),
      floorUnitPrice: l.floorUnitPaise === null ? null : paiseToRupees(l.floorUnitPaise),
      requestedUnitPrice: paiseToRupees(l.requestedUnitPaise),
      belowFloorBy: l.floorUnitPaise === null ? null : paiseToRupees(Math.max(0, l.floorUnitPaise - l.requestedUnitPaise)),
      ruleCommissionPerUnit: paiseToRupees(l.estCommissionPerUnitPaise),
      approvedCommissionPerUnit: l.approvedCommissionPerUnitPaise === null ? null : paiseToRupees(l.approvedCommissionPerUnitPaise),
    })),
  };
}

// GET /admin/discount-requests?status=pending
export const adminListDiscountRequests = async (req: Request, res: Response) => {
  const s = typeof req.query.status === "string" && req.query.status ? req.query.status : "pending";
  const filter: any = s === "all" ? {} : { status: s };
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorDiscountRequest.find(filter).sort({ createdAt: s === "pending" ? 1 : -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorDiscountRequest.countDocuments(filter),
  ]);
  const [partners, quotes] = await Promise.all([
    partnersById(rows.map((r) => r.ambassadorId)),
    AmbassadorQuotation.find({ _id: { $in: rows.map((r) => r.quotationId) } }).select("customer totals").lean(),
  ]);
  const qById = new Map(quotes.map((q: any) => [String(q._id), q]));
  res.json({ requests: rows.map((d) => drView(d, partners.get(String(d.ambassadorId)) || null, qById.get(String(d.quotationId)))), total, page: p, pageSize: PAGE_SIZE });
};

async function pendingRequest(req: Request) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return AmbassadorDiscountRequest.findById(req.params.id);
}

// POST /admin/discount-requests/:id/approve
// { lines: [{ itemId, commissionPerUnit (₹) }], note }
// Locks the special price in: the quotation becomes active for the normal
// validity window from now, and each approved line carries the commission
// the admin set (the rule alone pays ₹0 below the floor).
export const approveDiscountRequest = async (req: Request, res: Response) => {
  const dr = await pendingRequest(req);
  if (!dr) return res.status(404).json({ message: "Request not found" });
  if (dr.status !== "pending") return res.status(409).json({ message: `This request is already ${dr.status}` });

  const input = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const errors: Record<string, string> = {};
  const commissionByItem = new Map<string, number>();
  dr.lines.forEach((l, idx) => {
    const found = input.find((x: any) => String(x?.itemId) === String(l.itemId));
    const v = found?.commissionPerUnit;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors[`lines.${idx}`] = "Set the commission per unit (₹0 or more)";
    else if (rupeesToPaise(v) > l.requestedUnitPaise) errors[`lines.${idx}`] = "Commission can't exceed the selling price";
    else commissionByItem.set(String(l.itemId), rupeesToPaise(v));
  });
  if (Object.keys(errors).length) return res.status(400).json({ message: "Please correct the highlighted fields", errors });
  const note = clip(req.body?.note, 1000);

  const quote = await AmbassadorQuotation.findById(dr.quotationId);
  if (!quote || quote.status !== "pending_approval") return res.status(409).json({ message: "The quotation is no longer waiting for approval" });
  const partner = await AmbassadorProfile.findById(quote.ambassadorId).select("status").lean();
  if (!partner || partner.status !== "active") return res.status(409).json({ message: "The partner is not active" });

  // Stock may have moved since the partner asked.
  const qty = new Map<string, number>();
  quote.items.forEach((i) => qty.set(String(i.productId), (qty.get(String(i.productId)) || 0) + i.quantity));
  const products = await Product.find({ _id: { $in: [...qty.keys()] } }).select("title stock").lean();
  const short = products.filter((p: any) => (p.stock ?? 0) < (qty.get(String(p._id)) || 0)).map((p: any) => p.title);
  if (short.length || products.length !== qty.size) return res.status(409).json({ message: `Not enough stock now for: ${short.join(", ") || "a removed product"}. Reject and ask the partner to revise.` });

  const settings = await getSettings();
  const now = new Date();
  const before = { status: quote.status };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const items = quote.items.map((i: any) => {
        const o = i.toObject();
        if (commissionByItem.has(String(i._id))) o.approvedCommissionPerUnitPaise = commissionByItem.get(String(i._id));
        return o;
      });
      const r = await AmbassadorQuotation.updateOne(
        { _id: quote._id, status: "pending_approval" },
        {
          $set: { items, totals: quoteTotals(items), status: "active", validUntil: new Date(now.getTime() + settings.quotationValidityHours * 3600000), stockCheckedAt: now },
          $push: { statusHistory: { status: "active", at: now, by: me(req)._id, note: "special price approved" } },
        },
        { session }
      );
      if (r.modifiedCount !== 1) throw Object.assign(new Error("The quotation is no longer waiting for approval"), { status: 409 });
      dr.lines.forEach((l) => (l.approvedCommissionPerUnitPaise = commissionByItem.get(String(l.itemId)) ?? null));
      dr.status = "approved";
      dr.decision = { by: me(req)._id, at: now, note };
      await dr.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await audit({
    actor: me(req),
    action: "ambassador.discount.approve",
    targetType: "AmbassadorDiscountRequest",
    targetId: String(dr._id),
    before,
    after: { status: "active" },
    meta: { quoteNumber: dr.quoteNumber, version: dr.quoteVersion, lines: dr.lines.map((l) => ({ title: l.title, requestedUnitPaise: l.requestedUnitPaise, floorUnitPaise: l.floorUnitPaise, approvedCommissionPerUnitPaise: l.approvedCommissionPerUnitPaise })), note },
  });
  if (quote.leadId) {
    await AmbassadorLeadActivity.create({ leadId: quote.leadId, actorId: me(req)._id, actorType: "staff", type: "quotation", description: `Special price approved for ${dr.quoteNumber} v${dr.quoteVersion}` });
  }
  res.json({ ok: true });
};

// POST /admin/discount-requests/:id/reject { reason }
export const rejectDiscountRequest = async (req: Request, res: Response) => {
  const reason = clip(req.body?.reason, 1000);
  if (!reason) return res.status(400).json({ message: "Give a reason the partner will see", errors: { reason: "Required" } });
  const dr = await pendingRequest(req);
  if (!dr) return res.status(404).json({ message: "Request not found" });
  if (dr.status !== "pending") return res.status(409).json({ message: `This request is already ${dr.status}` });
  const now = new Date();
  const r = await AmbassadorDiscountRequest.updateOne({ _id: dr._id, status: "pending" }, { $set: { status: "rejected", decision: { by: me(req)._id, at: now, note: reason } } });
  if (r.modifiedCount !== 1) return res.status(409).json({ message: "This request was decided in the meantime" });
  await AmbassadorQuotation.updateOne(
    { _id: dr.quotationId, status: "pending_approval" },
    { $set: { status: "rejected" }, $push: { statusHistory: { status: "rejected", at: now, by: me(req)._id, note: reason } } }
  );
  await audit({ actor: me(req), action: "ambassador.discount.reject", targetType: "AmbassadorDiscountRequest", targetId: String(dr._id), meta: { quoteNumber: dr.quoteNumber, version: dr.quoteVersion, reason } });
  res.json({ ok: true });
};
