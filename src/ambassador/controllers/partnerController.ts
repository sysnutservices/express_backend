import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import AmbassadorProfile from "../models/AmbassadorProfile";
import AmbassadorLead from "../models/AmbassadorLead";
import AmbassadorLeadActivity from "../models/AmbassadorLeadActivity";
import AmbassadorCommission from "../models/AmbassadorCommission";
import AmbassadorCommissionRule from "../models/AmbassadorCommissionRule";
import AmbassadorWaitlist from "../models/AmbassadorWaitlist";
import AmbassadorQuotation from "../models/AmbassadorQuotation";
import Product from "../../models/Product";
import Order from "../../models/Order";
import User from "../../models/User";
import { nextSeq } from "../../models/Counter";
import { calculateProductPrice } from "../../utils/pricing";
import { getSettings } from "../services/settings";
import { encrypt, encryptionConfigured, hmac, maskAccount, maskPan, maskUpi } from "../services/crypto";
import { formatPartnerCode, normalizePartnerCode } from "../services/attribution";
import { pickRule } from "../services/commissionCalc";
import { toCommissionView, toPartnerProfileView } from "../services/views";
import { validateLeadCreate, validateLeadUpdate, validateRegistration } from "../validation";
import { normalizePhone, paiseToRupees } from "../money";

const me = (req: Request) => (req as any).user;
const amb = (req: Request) => (req as any).ambassador;
const page = (req: Request) => Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
const PAGE_SIZE = 25;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /partners/programme — public. The cohort/interest numbers are real
// counts from the database (they drive the landing page's live counter);
// nothing here is a marketing figure.
let countsCache: { at: number; value: { cohortTaken: number; interest: number } } | null = null;
export const invalidatePublicCounts = () => {
  countsCache = null;
};
async function publicCounts() {
  if (countsCache && Date.now() - countsCache.at < 60_000) return countsCache.value;
  const [cohortTaken, applications, waitlist] = await Promise.all([
    AmbassadorProfile.countDocuments({ status: { $in: ["approved", "active", "suspended"] } }),
    AmbassadorProfile.countDocuments({}),
    AmbassadorWaitlist.countDocuments({}),
  ]);
  const value = { cohortTaken, interest: applications + waitlist };
  countsCache = { at: Date.now(), value };
  return value;
}

export const getProgramme = async (_req: Request, res: Response) => {
  const s = await getSettings();
  const counts = await publicCounts();
  res.json({
    programmeEnabled: s.programmeEnabled,
    registrationOpen: s.registrationOpen,
    agreementVersion: s.agreementVersion,
    minimumAge: s.minimumAge,
    leadOwnershipDays: s.leadOwnershipDays,
    partnerTypes: ["referral", "independent"],
    cohort: { size: s.foundingCohortSize ?? 20, taken: Math.min(counts.cohortTaken, s.foundingCohortSize ?? 20) },
    interestCount: counts.interest,
  });
};

// POST /partners/waitlist — public, rate-limited. Reserve-a-spot form on the
// landing page while registration is invite-only or not yet open.
export const joinWaitlist = async (req: Request, res: Response) => {
  const b = req.body || {};
  const errors: Record<string, string> = {};
  const fullName = typeof b.fullName === "string" ? b.fullName.trim().slice(0, 100) : "";
  if (fullName.length < 2) errors.fullName = "Enter your full name";
  const phone = normalizePhone(b.phone);
  if (!phone) errors.phone = "Enter a valid 10-digit mobile number";
  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim().toLowerCase().slice(0, 254) : undefined;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address";
  const partnerType = b.partnerType === "independent" ? "independent" : "referral";
  if (b.consent !== true) errors.consent = "Please agree to be contacted about the programme";
  if (Object.keys(errors).length) return res.status(400).json({ message: "Please correct the highlighted fields", errors });

  const clip = (v: unknown, n = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const existingPartner = await AmbassadorProfile.exists({ phone });
  if (existingPartner) return res.status(409).json({ message: "This number has already applied. Sign in to your partner dashboard.", code: "ALREADY_REGISTERED" });

  const now = new Date();
  const r = await AmbassadorWaitlist.updateOne(
    { phone },
    {
      // First-touch campaign source wins: a repeat submission must not wipe
      // the UTM that brought the person in (cost-per-signup reporting).
      $setOnInsert: {
        phone,
        status: "waiting",
        consent: { given: true, at: now },
        source: { utmSource: clip(b.utmSource), utmMedium: clip(b.utmMedium), utmCampaign: clip(b.utmCampaign), referrer: clip(b.referrer, 200) },
      },
      $set: { fullName, email, city: clip(b.city), occupation: clip(b.occupation), partnerType },
    },
    { upsert: true }
  );
  countsCache = null;
  const position = await AmbassadorWaitlist.countDocuments({ status: "waiting" });
  res.status(r.upsertedCount ? 201 : 200).json({ ok: true, alreadyOnList: !r.upsertedCount, waitingCount: position });
};

// GET /partners/referral/:code — public, leaks nothing but validity
export const checkReferralCode = async (req: Request, res: Response) => {
  const code = normalizePartnerCode(req.params.code);
  if (!code) return res.json({ valid: false });
  const s = await getSettings();
  if (!s.programmeEnabled) return res.json({ valid: false });
  const exists = await AmbassadorProfile.exists({ partnerCode: code, status: "active" });
  res.json({ valid: !!exists });
};

// POST /partners/register — logged-in user (mobile already OTP-verified)
export const register = async (req: Request, res: Response) => {
  const settings = await getSettings();
  if (!settings.programmeEnabled) return res.status(503).json({ message: "The partner programme is not open yet" });

  const user = me(req);
  const phone = normalizePhone(user.mobile);
  if (!phone) return res.status(400).json({ message: "Your account needs a verified mobile number" });
  if (!settings.registrationOpen && !settings.pilotAllowlist.includes(phone)) {
    return res.status(403).json({ message: "Registration is by invitation during the pilot. We'll open it to everyone soon." });
  }
  if (await AmbassadorProfile.exists({ userId: user._id })) {
    return res.status(409).json({ message: "You have already applied", code: "ALREADY_REGISTERED" });
  }
  if (!encryptionConfigured()) {
    console.error("[ambassador] AMBASSADOR_ENC_KEY / AMBASSADOR_HASH_KEY not configured — refusing registration");
    return res.status(503).json({ message: "Registration is temporarily unavailable" });
  }

  const v = validateRegistration(req.body, { minimumAge: settings.minimumAge, agreementVersion: settings.agreementVersion });
  if (!v.ok) return res.status(400).json({ message: "Please correct the highlighted fields", errors: v.errors });
  const input = v.value;

  const panHash = hmac("pan:" + input.pan);
  const payoutKey = input.payout.method === "upi" ? "upi:" + input.payout.upiId.toLowerCase() : `bank:${input.payout.ifsc}:${input.payout.accountNumber}`;
  const payoutHash = hmac(payoutKey);

  const dupes = await AmbassadorProfile.find({ $or: [{ panHash }, { email: input.email }, { phone }] }).select("panHash email phone").lean();
  if (dupes.some((d) => d.panHash === panHash)) return res.status(409).json({ message: "This PAN is already registered with another partner account", errors: { pan: "Already registered" } });
  if (dupes.some((d) => d.email === input.email)) return res.status(409).json({ message: "This email is already registered", errors: { email: "Already registered" } });
  if (dupes.some((d) => d.phone === phone)) return res.status(409).json({ message: "This mobile number is already registered" });

  const sharedPayout = await AmbassadorProfile.exists({ payoutHash });
  const now = new Date();
  const ip = req.ip;
  const payoutPlain = input.payout.method === "upi" ? input.payout.upiId : JSON.stringify({ accountName: input.payout.accountName, accountNumber: input.payout.accountNumber, ifsc: input.payout.ifsc });
  const payoutMasked = input.payout.method === "upi" ? maskUpi(input.payout.upiId) : `${maskAccount(input.payout.accountNumber)} · ${input.payout.ifsc}`;

  try {
    const profile = await AmbassadorProfile.create({
      userId: user._id,
      partnerCode: formatPartnerCode(await nextSeq("ambassador")),
      partnerType: input.partnerType,
      status: "application_submitted",
      statusHistory: [{ status: "application_submitted", at: now, by: user._id, reason: "self-registration" }],
      fullName: input.fullName,
      email: input.email,
      phone,
      dateOfBirth: input.dateOfBirth,
      address: input.address,
      city: input.address.city,
      state: input.address.state,
      business: input.business,
      occupation: input.occupation,
      heardFrom: input.heardFrom,
      pan: { encrypted: encrypt(input.pan), last4: input.pan.slice(-4) },
      panHash,
      payout: { method: input.payout.method, encrypted: encrypt(payoutPlain), masked: payoutMasked },
      payoutHash,
      agreement: { version: input.agreementVersion, acceptedAt: now, ip },
      agreementHistory: [{ version: input.agreementVersion, acceptedAt: now, ip }],
      flags: sharedPayout ? [{ type: "shared_payout_destination", detail: "Payout destination matches another partner", at: now }] : [],
    });
    await AmbassadorWaitlist.updateOne({ phone }, { $set: { status: "registered" } }).catch(() => undefined);
    countsCache = null;
    return res.status(201).json({ profile: toPartnerProfileView(profile.toObject()), maskedPan: maskPan(input.pan) });
  } catch (err: any) {
    if (err?.code === 11000) return res.status(409).json({ message: "These details are already registered with another partner account" });
    throw err;
  }
};

// GET /partners/profile — any logged-in user; 404 if not a partner
export const getProfile = async (req: Request, res: Response) => {
  const profile = await AmbassadorProfile.findOne({ userId: me(req)._id }).lean();
  if (!profile) return res.status(404).json({ message: "Not registered", code: "NOT_REGISTERED" });
  const settings = await getSettings();
  res.json({ profile: toPartnerProfileView(profile), programmeEnabled: settings.programmeEnabled });
};

// POST /partners/orientation/complete — approved → active
export const completeOrientation = async (req: Request, res: Response) => {
  const now = new Date();
  const profile = await AmbassadorProfile.findOneAndUpdate(
    { userId: me(req)._id, status: "approved" },
    {
      $set: { status: "active", orientationCompletedAt: now },
      $push: { statusHistory: { status: "active", at: now, by: me(req)._id, reason: "orientation completed" } },
    },
    { new: true }
  ).lean();
  if (!profile) return res.status(409).json({ message: "Orientation is available once your application is approved" });
  res.json({ profile: toPartnerProfileView(profile) });
};

// GET /partners/referral-link
export const getReferralLink = async (req: Request, res: Response) => {
  const s = await getSettings();
  const code = amb(req).partnerCode;
  const base = s.referralBaseUrl.endsWith("/") ? s.referralBaseUrl : s.referralBaseUrl + "/";
  const url = `${base}?ref=${encodeURIComponent(code)}`;
  res.json({ code, url, qrPayload: url });
};

// GET /partners/dashboard
export const getDashboard = async (req: Request, res: Response) => {
  const a = amb(req);
  const ambassadorId = a._id as Types.ObjectId;
  const [leadAgg, commAgg, monthly] = await Promise.all([
    AmbassadorLead.aggregate([{ $match: { ambassadorId } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    AmbassadorCommission.aggregate([
      { $match: { ambassadorId, superseded: false } },
      {
        $group: {
          _id: "$status",
          amount: { $sum: "$commissionPaise" },
          sales: { $sum: { $multiply: ["$unitSellingPricePaise", "$quantity"] } },
          units: { $sum: "$quantity" },
          orders: { $addToSet: "$orderId" },
        },
      },
    ]),
    AmbassadorCommission.aggregate([
      { $match: { ambassadorId, superseded: false, status: { $ne: "reversed" }, createdAt: { $gte: new Date(Date.now() - 183 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: "Asia/Kolkata" } }, commission: { $sum: "$commissionPaise" }, units: { $sum: "$quantity" } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const leads = Object.fromEntries(leadAgg.map((l: any) => [l._id, l.n]));
  const [quotationCount, followUpsDue] = await Promise.all([
    a.partnerType === "independent" ? AmbassadorQuotation.countDocuments({ ambassadorId, status: { $nin: ["superseded", "cancelled"] } }) : Promise.resolve(0),
    AmbassadorLead.countDocuments({ ambassadorId, followUpAt: { $ne: null, $lte: new Date() }, status: { $nin: ["won", "lost"] } }),
  ]);
  const totalLeads = leadAgg.reduce((s: number, l: any) => s + l.n, 0);
  const byStatus = Object.fromEntries(commAgg.map((c: any) => [c._id, c]));
  const sum = (statuses: string[], field: "amount" | "sales" | "units") => statuses.reduce((s, st) => s + (byStatus[st]?.[field] || 0), 0);
  const completedStatuses = ["delivery_confirmed", "eligible", "approved", "processing", "paid"];
  const completedOrders = new Set(completedStatuses.flatMap((st) => (byStatus[st]?.orders || []).map(String))).size;

  res.json({
    partner: { partnerCode: a.partnerCode, partnerType: a.partnerType, fullName: a.fullName },
    cards: {
      totalLeads,
      activeLeads: totalLeads - (leads.won || 0) - (leads.lost || 0),
      // Independent partners: real quotations issued; referral partners: leads marked "quotation sent".
      quotationsSent: a.partnerType === "independent" ? quotationCount : leads.quotation_sent || 0,
      followUpsDue,
      ordersCompleted: completedOrders,
      laptopsSold: sum(["pending", ...completedStatuses], "units"),
      totalSales: paiseToRupees(sum(["pending", ...completedStatuses], "sales")),
      pendingCommission: paiseToRupees(sum(["pending", "delivery_confirmed", "eligible"], "amount")),
      approvedCommission: paiseToRupees(sum(["approved", "processing"], "amount")),
      paidCommission: paiseToRupees(sum(["paid"], "amount")),
    },
    leadConversion: { total: totalLeads, won: leads.won || 0, rate: totalLeads ? Math.round(((leads.won || 0) / totalLeads) * 1000) / 10 : 0 },
    leadsByStatus: leads,
    monthly: monthly.map((m: any) => ({ month: m._id, commission: paiseToRupees(m.commission), units: m.units })),
  });
};

// GET /partners/products — live, in-stock catalogue with whitelisted fields
const PARTNER_PRODUCT_FIELDS =
  "title slug brand category specs price discountPercent finalPrice stock image condition qualityReport.batteryHealthPercent configOptions extraOffer useCases performanceTier";

export const getProducts = async (req: Request, res: Response) => {
  const a = amb(req);
  const filter: any = { stock: { $gt: 0 } };
  if (typeof req.query.category === "string" && req.query.category) filter.category = req.query.category;
  if (typeof req.query.brand === "string" && req.query.brand) filter.brand = req.query.brand;
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim().slice(0, 60)), "i");
    filter.$or = [{ title: rx }, { brand: rx }, { "specs.processor": rx }];
  }
  const products = await Product.find(filter).select(PARTNER_PRODUCT_FIELDS).sort({ updatedAt: -1 }).limit(200).lean();

  const independent = a.partnerType === "independent";
  const rules = independent ? await AmbassadorCommissionRule.find({ partnerType: "independent", status: "active" }).lean() : [];

  const out = products.map((p: any) => {
    const priced = calculateProductPrice(p.finalPrice, p.extraOffer);
    const view: any = {
      _id: p._id,
      title: p.title,
      slug: p.slug,
      brand: p.brand,
      category: p.category,
      image: p.image,
      specs: p.specs,
      condition: p.condition,
      batteryHealthPercent: p.qualityReport?.batteryHealthPercent ?? null,
      warrantyOptions: (p.configOptions?.warranty || []).map((w: any) => w.label),
      mrp: p.price,
      sellingPrice: priced.finalPrice,
      offerLabel: priced.offer?.offerLabel,
      stockStatus: p.stock > 3 ? "in_stock" : "low_stock",
      productUrl: p.slug ? `https://lapshark.com/products/${p.slug}` : null,
    };
    if (independent) {
      const rule: any = pickRule(rules as any[], "independent", String(p._id));
      view.partnerMinimumPrice = rule?.kind === "margin_share" && rule.minimumPricePaise !== null ? paiseToRupees(rule.minimumPricePaise) : null;
      // Customer-facing add-on prices (same as the product page), for the
      // quotation builder. Add-ons are sold at face value.
      const opts = (k: string) => (p.configOptions?.[k] || []).map((o: any) => ({ value: o.value, label: o.label, price: o.price || 0 }));
      view.configOptions = { ram: opts("ram"), storage: opts("storage"), warranty: opts("warranty") };
      view.stock = Math.min(p.stock, 5);
    }
    return view;
  });
  res.json({ products: out, count: out.length });
};

// ---- Leads --------------------------------------------------------------

export const listLeads = async (req: Request, res: Response) => {
  const filter: any = { ambassadorId: amb(req)._id };
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    const q = req.query.q.trim().slice(0, 60);
    filter.$or = [{ customerName: new RegExp(escapeRegex(q), "i") }, { phone: new RegExp(escapeRegex(q.replace(/\D/g, "") || q)) }];
  }
  if (req.query.due === "1") filter.followUpAt = { $ne: null, $lte: new Date() };
  const p = page(req);
  const [leads, total] = await Promise.all([
    AmbassadorLead.find(filter).sort({ updatedAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorLead.countDocuments(filter),
  ]);
  res.json({ leads: leads.map(leadView), total, page: p, pageSize: PAGE_SIZE });
};

function leadView(l: any) {
  const { budgetPaise, ...rest } = l;
  return { ...rest, budget: budgetPaise === undefined || budgetPaise === null ? null : paiseToRupees(budgetPaise), ownershipActive: new Date(l.ownershipExpiresAt) > new Date() };
}

export const createLead = async (req: Request, res: Response) => {
  const v = validateLeadCreate(req.body);
  if (!v.ok) return res.status(400).json({ message: "Please correct the highlighted fields", errors: v.errors });
  const a = amb(req);
  const input = v.value;
  const now = new Date();

  if (input.phone === a.phone) return res.status(400).json({ message: "You can't register yourself as a lead", errors: { phone: "This is your own number" } });

  const owned = await AmbassadorLead.findOne({ phone: input.phone, ownershipExpiresAt: { $gt: now }, status: { $ne: "lost" } }).select("ambassadorId").lean();
  if (owned) {
    if (String(owned.ambassadorId) === String(a._id)) return res.status(409).json({ message: "You already have this customer as a lead", existingLeadId: owned._id });
    return res.status(409).json({ message: "This customer is already registered with another partner" });
  }

  const buyers = await User.find({ mobile: input.phone }).select("_id").lean();
  const existingCustomer = buyers.length
    ? !!(await Order.exists({ userId: { $in: buyers.map((b) => b._id) }, paymentStatus: "Paid", status: { $nin: ["Cancelled", "RTO"] } } as any))
    : false;

  const settings = await getSettings();
  const lead = await AmbassadorLead.create({
    ...input,
    ambassadorId: a._id,
    status: "new",
    consent: { given: true, at: now, method: "partner_declared" },
    ownershipExpiresAt: new Date(now.getTime() + settings.leadOwnershipDays * 86400000),
    existingCustomer,
  });
  await AmbassadorLeadActivity.create({ leadId: lead._id, actorId: me(req)._id, actorType: "ambassador", type: "created", description: "Lead created" });
  res.status(201).json({
    lead: leadView(lead.toObject()),
    notice: existingCustomer ? "This customer has bought from Lapshark before. Commission on their orders needs Lapshark approval." : undefined,
  });
};

async function ownLead(req: Request) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return AmbassadorLead.findOne({ _id: req.params.id, ambassadorId: amb(req)._id });
}

export const getLead = async (req: Request, res: Response) => {
  const lead = await ownLead(req);
  if (!lead) return res.status(404).json({ message: "Lead not found" });
  const activities = await AmbassadorLeadActivity.find({ leadId: lead._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ lead: leadView(lead.toObject()), activities });
};

export const updateLead = async (req: Request, res: Response) => {
  const v = validateLeadUpdate(req.body);
  if (!v.ok) return res.status(400).json({ message: "Please correct the highlighted fields", errors: v.errors });
  const lead = await ownLead(req);
  if (!lead) return res.status(404).json({ message: "Lead not found" });
  if (lead.status === "won") return res.status(409).json({ message: "This lead has a completed order and can't be changed" });

  const before = lead.status;
  Object.assign(lead, v.value);
  await lead.save();
  const actorId = me(req)._id;
  const acts: any[] = [];
  if (v.value.status && v.value.status !== before) acts.push({ type: "status_changed", description: `Status: ${before} → ${v.value.status}`, metadata: { from: before, to: v.value.status } });
  if (v.value.followUpAt !== undefined) acts.push({ type: "follow_up_set", description: v.value.followUpAt ? `Follow-up set for ${v.value.followUpAt.toISOString()}` : "Follow-up cleared" });
  const otherKeys = Object.keys(v.value).filter((k) => k !== "status" && k !== "followUpAt");
  if (otherKeys.length) acts.push({ type: "updated", description: `Updated ${otherKeys.join(", ")}` });
  if (acts.length) await AmbassadorLeadActivity.insertMany(acts.map((x) => ({ ...x, leadId: lead._id, actorId, actorType: "ambassador" })));
  res.json({ lead: leadView(lead.toObject()) });
};

export const addLeadNote = async (req: Request, res: Response) => {
  const text = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 2000) : "";
  if (!text) return res.status(400).json({ message: "Write a note", errors: { note: "Required" } });
  const lead = await ownLead(req);
  if (!lead) return res.status(404).json({ message: "Lead not found" });
  const act = await AmbassadorLeadActivity.create({ leadId: lead._id, actorId: me(req)._id, actorType: "ambassador", type: "note", description: text });
  await AmbassadorLead.updateOne({ _id: lead._id }, { $set: { updatedAt: new Date() } });
  res.status(201).json({ activity: act });
};

// ---- Commissions --------------------------------------------------------

export const listCommissions = async (req: Request, res: Response) => {
  const filter: any = { ambassadorId: amb(req)._id, superseded: false };
  if (typeof req.query.status === "string" && req.query.status) filter.status = req.query.status;
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorCommission.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorCommission.countDocuments(filter),
  ]);
  res.json({ commissions: rows.map((c) => toCommissionView(c, { staff: false })), total, page: p, pageSize: PAGE_SIZE });
};
