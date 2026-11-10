// Phase 3: finance approval, payout batches, adjustments, reconciliation,
// and the partner's own payout history. Spec: distribution/docs/04-api.md.
import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import AmbassadorCommission from "../models/AmbassadorCommission";
import AmbassadorProfile from "../models/AmbassadorProfile";
import AmbassadorPayout from "../models/AmbassadorPayout";
import AmbassadorAdjustment from "../models/AmbassadorAdjustment";
import { audit } from "../services/audit";
import { toCommissionView } from "../services/views";
import { createPayoutBatch, markPayoutFailed, markPayoutPaid, PayoutError, readyToPay, reconciliation, runEligibility } from "../services/payoutService";
import { IDEMPOTENCY_KEY_RE, PAYOUT_REFERENCE_RE } from "../services/payoutCalc";
import { paiseToRupees, rupeesToPaise } from "../money";

const me = (req: Request) => (req as any).user;
const amb = (req: Request) => (req as any).ambassador;
const R = paiseToRupees;
const PAGE_SIZE = 50;
const page = (req: Request) => Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
const clip = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : "");

function payoutView(p: any, opts: { staff: boolean }) {
  const v: any = {
    _id: p._id,
    payoutNumber: p.payoutNumber,
    status: p.status,
    method: p.method,
    destinationMasked: p.destinationMasked,
    gross: R(p.grossPaise),
    adjustments: R(p.adjustmentsPaise),
    tdsPercent: p.tdsPercent,
    tds: R(p.tdsPaise),
    net: R(p.netPaise),
    commissionCount: p.commissionIds?.length || 0,
    adjustmentCount: p.adjustmentIds?.length || 0,
    reference: p.reference,
    paidAt: p.paidAt,
    failureReason: p.status === "failed" ? p.failureReason : undefined,
    createdAt: p.createdAt,
  };
  if (opts.staff) Object.assign(v, { ambassadorId: p.ambassadorId, partnerCode: p.partnerCode, batchKey: p.batchKey, statusHistory: p.statusHistory, failedAt: p.failedAt });
  return v;
}

function adjustmentView(a: any) {
  return {
    _id: a._id,
    ambassadorId: a.ambassadorId,
    kind: a.kind,
    amount: R(a.amountPaise),
    reason: a.reason,
    orderNumber: a.orderNumber,
    status: a.status,
    payoutId: a.payoutId,
    voidReason: a.voidReason,
    createdAt: a.createdAt,
  };
}

function sendPayoutError(res: Response, err: unknown) {
  if (err instanceof PayoutError) return res.status(err.status).json({ message: err.message });
  throw err;
}

// ---- admin: eligibility + approval ----------------------------------------

// POST /admin/commissions/run-eligibility — same job as the hourly timer.
export const runEligibilityNow = async (req: Request, res: Response) => {
  const r = await runEligibility();
  await audit({ actor: me(req), action: "ambassador.commission.run_eligibility", targetType: "AmbassadorCommission", targetId: "-", meta: r as any });
  res.json(r);
};

// POST /admin/commissions/approve { ids: [] } — eligible → approved.
export const approveCommissions = async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((i: unknown) => mongoose.isValidObjectId(i)).slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ message: "Select commission lines to approve", errors: { ids: "Required" } });
  const now = new Date();
  const r = await AmbassadorCommission.updateMany(
    { _id: { $in: ids }, status: "eligible", hold: null, superseded: false },
    { $set: { status: "approved", approvedAt: now, approvedBy: me(req)._id }, $push: { statusHistory: { status: "approved", at: now, by: me(req)._id, reason: "finance approval" } } }
  );
  await audit({ actor: me(req), action: "ambassador.commission.approve", targetType: "AmbassadorCommission", targetId: ids.length === 1 ? String(ids[0]) : "-", meta: { requested: ids.length, approved: r.modifiedCount, ids: ids.map(String) } });
  res.json({ approved: r.modifiedCount, skipped: ids.length - r.modifiedCount });
};

// ---- admin: payouts ---------------------------------------------------------

// GET /admin/payouts/ready — what a batch would pay right now, per partner.
export const getReadyToPay = async (_req: Request, res: Response) => {
  const rows = await readyToPay();
  res.json({
    partners: rows.map((r) => ({
      ...r,
      totals: { gross: R(r.totals.grossPaise), adjustments: R(r.totals.adjustmentsPaise), tdsPercent: r.totals.tdsPercent, tds: R(r.totals.tdsPaise), net: R(r.totals.netPaise) },
    })),
  });
};

// POST /admin/payouts  (Idempotency-Key header required) { ambassadorIds?: [] }
export const createPayouts = async (req: Request, res: Response) => {
  const key = String(req.get("Idempotency-Key") || "");
  if (!IDEMPOTENCY_KEY_RE.test(key)) return res.status(400).json({ message: "Idempotency-Key header (16-100 letters, digits, - or _) is required" });
  const ids = Array.isArray(req.body?.ambassadorIds) ? req.body.ambassadorIds.filter((i: unknown) => mongoose.isValidObjectId(i)).map(String) : undefined;
  const r = await createPayoutBatch({ batchKey: key, ambassadorIds: ids?.length ? ids : undefined, by: me(req)._id });
  if (!r.replay && r.created.length) {
    await audit({
      actor: me(req),
      action: "ambassador.payout.create",
      targetType: "AmbassadorPayout",
      targetId: r.created.length === 1 ? String(r.created[0]._id) : key,
      meta: { batchKey: key, payouts: r.created.map((p: any) => ({ payoutNumber: p.payoutNumber, partnerCode: p.partnerCode, netPaise: p.netPaise })), skipped: r.skipped },
    });
  }
  res.status(r.replay ? 200 : 201).json({ replay: r.replay, payouts: r.created.map((p: any) => payoutView(p, { staff: true })), skipped: r.skipped });
};

// GET /admin/payouts?status=&ambassadorId=
export const listPayouts = async (req: Request, res: Response) => {
  const filter: any = {};
  if (typeof req.query.status === "string" && ["processing", "paid", "failed"].includes(req.query.status)) filter.status = req.query.status;
  if (typeof req.query.ambassadorId === "string" && mongoose.isValidObjectId(req.query.ambassadorId)) filter.ambassadorId = req.query.ambassadorId;
  const p = page(req);
  const [rows, total] = await Promise.all([
    AmbassadorPayout.find(filter).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    AmbassadorPayout.countDocuments(filter),
  ]);
  const partners = await AmbassadorProfile.find({ _id: { $in: rows.map((r) => r.ambassadorId) } }).select("fullName").lean();
  const name = new Map(partners.map((x: any) => [String(x._id), x.fullName]));
  res.json({ payouts: rows.map((r) => ({ ...payoutView(r, { staff: true }), partnerName: name.get(String(r.ambassadorId)) })), total, page: p, pageSize: PAGE_SIZE });
};

// GET /admin/payouts/:id — with its lines.
export const getPayout = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Payout not found" });
  const p = await AmbassadorPayout.findById(req.params.id).lean();
  if (!p) return res.status(404).json({ message: "Payout not found" });
  const [comms, adjs, partner] = await Promise.all([
    AmbassadorCommission.find({ _id: { $in: p.commissionIds } }).lean(),
    AmbassadorAdjustment.find({ _id: { $in: p.adjustmentIds } }).lean(),
    AmbassadorProfile.findById(p.ambassadorId).select("fullName partnerCode").lean(),
  ]);
  res.json({ payout: { ...payoutView(p, { staff: true }), partnerName: partner?.fullName }, commissions: comms.map((c) => toCommissionView(c, { staff: true })), adjustments: adjs.map(adjustmentView) });
};

// POST /admin/payouts/:id/mark-paid { reference, paidAt? }
export const markPaid = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Payout not found" });
  const reference = clip(req.body?.reference, 100);
  if (!PAYOUT_REFERENCE_RE.test(reference)) return res.status(400).json({ message: "Enter the bank/UPI transaction reference (UTR)", errors: { reference: "4-100 characters" } });
  let paidAt = new Date();
  if (req.body?.paidAt) {
    paidAt = new Date(req.body.paidAt);
    if (Number.isNaN(paidAt.getTime()) || paidAt > new Date(Date.now() + 5 * 60000)) return res.status(400).json({ message: "Invalid payment date", errors: { paidAt: "Can't be in the future" } });
  }
  try {
    const r = await markPayoutPaid(req.params.id, reference, paidAt, me(req)._id);
    if (!r.alreadyPaid) {
      await audit({ actor: me(req), action: "ambassador.payout.paid", targetType: "AmbassadorPayout", targetId: String(r.payout!._id), before: { status: "processing" }, after: { status: "paid" }, meta: { payoutNumber: r.payout!.payoutNumber, reference, netPaise: r.payout!.netPaise } });
    }
    res.json({ payout: payoutView(r.payout, { staff: true }), alreadyPaid: r.alreadyPaid });
  } catch (err) {
    return sendPayoutError(res, err);
  }
};

// POST /admin/payouts/:id/fail { reason }
export const markFailed = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Payout not found" });
  const reason = clip(req.body?.reason, 300);
  if (!reason) return res.status(400).json({ message: "Give the reason the transfer failed", errors: { reason: "Required" } });
  try {
    const r = await markPayoutFailed(req.params.id, reason, me(req)._id);
    await audit({ actor: me(req), action: "ambassador.payout.failed", targetType: "AmbassadorPayout", targetId: String(r.payout!._id), before: { status: "processing" }, after: { status: "failed" }, meta: { payoutNumber: r.payout!.payoutNumber, reason, reversedLines: r.reversedLines } });
    res.json({ payout: payoutView(r.payout, { staff: true }), reversedLines: r.reversedLines });
  } catch (err) {
    return sendPayoutError(res, err);
  }
};

// GET /admin/payouts/reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getReconciliation = async (req: Request, res: Response) => {
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 31 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) return res.status(400).json({ message: "Invalid date range" });
  const toExclusive = req.query.to ? new Date(to.getTime() + 86400000) : to;
  const r = await reconciliation(from, toExclusive);
  res.json({
    from,
    to: toExclusive,
    rows: r.rows.map((x) => ({ ...x, gross: R(x.grossPaise), adjustments: R(x.adjustmentsPaise), tds: R(x.tdsPaise), net: R(x.netPaise) })),
    totals: {
      count: r.totals.count,
      inconsistent: r.totals.inconsistent,
      paid: { count: r.totals.paid.count, net: R(r.totals.paid.netPaise), tds: R(r.totals.paid.tdsPaise) },
      processing: { count: r.totals.processing.count, net: R(r.totals.processing.netPaise) },
      failed: { count: r.totals.failed.count, net: R(r.totals.failed.netPaise) },
    },
  });
};

// ---- admin: adjustments ------------------------------------------------------

export const listAdjustments = async (req: Request, res: Response) => {
  const filter: any = {};
  if (typeof req.query.status === "string" && ["open", "in_payout", "settled", "void"].includes(req.query.status)) filter.status = req.query.status;
  if (typeof req.query.ambassadorId === "string" && mongoose.isValidObjectId(req.query.ambassadorId)) filter.ambassadorId = req.query.ambassadorId;
  const rows = await AmbassadorAdjustment.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  const partners = await AmbassadorProfile.find({ _id: { $in: rows.map((r) => r.ambassadorId) } }).select("fullName partnerCode").lean();
  const byId = new Map(partners.map((x: any) => [String(x._id), x]));
  res.json({ adjustments: rows.map((a) => ({ ...adjustmentView(a), partner: byId.get(String(a.ambassadorId)) || null })) });
};

// POST /admin/partner-adjustments { ambassadorId, amount (₹, signed), reason }
export const createAdjustment = async (req: Request, res: Response) => {
  const b = req.body || {};
  const errors: Record<string, string> = {};
  if (!mongoose.isValidObjectId(b.ambassadorId)) errors.ambassadorId = "Choose a partner";
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000 || Math.round(amount * 100) !== amount * 100) errors.amount = "Non-zero ₹ amount, up to 2 decimals (negative reduces the next payout)";
  const reason = clip(b.reason, 500);
  if (reason.length < 5) errors.reason = "Explain the adjustment";
  if (Object.keys(errors).length) return res.status(400).json({ message: "Please correct the highlighted fields", errors });
  const partner = await AmbassadorProfile.findById(b.ambassadorId).select("_id partnerCode").lean();
  if (!partner) return res.status(404).json({ message: "Partner not found" });
  const a = await AmbassadorAdjustment.create({ ambassadorId: partner._id, kind: "manual", amountPaise: rupeesToPaise(amount), reason, status: "open", createdBy: me(req)._id });
  await audit({ actor: me(req), action: "ambassador.adjustment.create", targetType: "AmbassadorAdjustment", targetId: String(a._id), after: { amountPaise: a.amountPaise, partnerCode: partner.partnerCode }, meta: { reason } });
  res.status(201).json({ adjustment: adjustmentView(a) });
};

// POST /admin/partner-adjustments/:id/void { reason } — open ones only.
export const voidAdjustment = async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Adjustment not found" });
  const reason = clip(req.body?.reason, 300);
  if (!reason) return res.status(400).json({ message: "Give a reason", errors: { reason: "Required" } });
  const now = new Date();
  const a = await AmbassadorAdjustment.findOneAndUpdate({ _id: req.params.id, status: "open" }, { $set: { status: "void", voidedAt: now, voidedBy: me(req)._id, voidReason: reason } }, { new: true }).lean();
  if (!a) return res.status(409).json({ message: "Only open adjustments can be voided (this one is in a payout, settled or already void)" });
  await audit({ actor: me(req), action: "ambassador.adjustment.void", targetType: "AmbassadorAdjustment", targetId: String(a._id), before: { status: "open" }, after: { status: "void" }, meta: { reason, amountPaise: a.amountPaise } });
  res.json({ adjustment: adjustmentView(a) });
};

// ---- partner ---------------------------------------------------------------

// GET /partners/payouts — own payouts + what's coming.
export const partnerPayouts = async (req: Request, res: Response) => {
  const a = amb(req);
  const ambassadorId = new Types.ObjectId(String(a._id));
  const [payouts, byStatus, openAdj] = await Promise.all([
    AmbassadorPayout.find({ ambassadorId }).sort({ createdAt: -1 }).limit(100).lean(),
    AmbassadorCommission.aggregate([
      { $match: { ambassadorId, superseded: false, status: { $in: ["eligible", "approved", "processing"] } } },
      { $group: { _id: "$status", amount: { $sum: "$commissionPaise" }, n: { $sum: 1 } } },
    ]),
    AmbassadorAdjustment.find({ ambassadorId, status: "open" }).sort({ createdAt: -1 }).lean(),
  ]);
  const s = Object.fromEntries(byStatus.map((x: any) => [x._id, x]));
  res.json({
    summary: {
      eligible: R(s.eligible?.amount || 0),
      approved: R(s.approved?.amount || 0),
      inPayout: R(s.processing?.amount || 0),
      openAdjustments: R(openAdj.reduce((t, x) => t + x.amountPaise, 0)),
    },
    adjustments: openAdj.map((x) => ({ amount: R(x.amountPaise), reason: x.reason, kind: x.kind, createdAt: x.createdAt })),
    payouts: payouts.map((p) => payoutView(p, { staff: false })),
  });
};
