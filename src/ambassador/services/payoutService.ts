// Phase 3: eligibility, payout batches, paid/failed, clawbacks.
// Rules are in payoutCalc.ts (pure, unit-tested); this file does the DB work
// with guarded status transitions so every step is safe to repeat.
import mongoose, { Types } from "mongoose";
import Order from "../../models/Order";
import { nextSeq } from "../../models/Counter";
import AmbassadorCommission from "../models/AmbassadorCommission";
import AmbassadorProfile from "../models/AmbassadorProfile";
import AmbassadorPayout from "../models/AmbassadorPayout";
import AmbassadorAdjustment from "../models/AmbassadorAdjustment";
import { getSettings } from "./settings";
import { checkEligibility, payoutTotals } from "./payoutCalc";

export const formatPayoutNumber = (seq: number) => `LSP-${String(seq).padStart(6, "0")}`;

// ---- eligibility ----------------------------------------------------------

export interface EligibilityRun {
  checked: number;
  madeEligible: number;
  waiting: Record<string, number>;
}

export async function runEligibility(now: Date = new Date()): Promise<EligibilityRun> {
  const settings = await getSettings();
  const lines = await AmbassadorCommission.find({ status: "delivery_confirmed", superseded: false, hold: null })
    .select("_id orderId ambassadorId status hold deliveredAt")
    .limit(5000)
    .lean();
  const out: EligibilityRun = { checked: lines.length, madeEligible: 0, waiting: {} };
  if (!lines.length) return out;
  const [orders, partners] = await Promise.all([
    Order.find({ _id: { $in: [...new Set(lines.map((l) => String(l.orderId)))] } })
      .select("status paymentStatus paymentMethod total advanceAmount codCollected cancellation refund.id refund.status shipment.deliveredAt")
      .lean(),
    AmbassadorProfile.find({ _id: { $in: [...new Set(lines.map((l) => String(l.ambassadorId)))] } }).select("status").lean(),
  ]);
  const orderById = new Map(orders.map((o: any) => [String(o._id), o]));
  const partnerById = new Map(partners.map((p: any) => [String(p._id), p.status]));
  for (const l of lines) {
    const r = checkEligibility({
      now,
      holdDays: settings.eligibilityHoldDays,
      commission: l as any,
      order: (orderById.get(String(l.orderId)) as any) || null,
      partnerStatus: partnerById.get(String(l.ambassadorId)) || null,
    });
    if (!r.eligible) {
      out.waiting[r.reason] = (out.waiting[r.reason] || 0) + 1;
      continue;
    }
    const u = await AmbassadorCommission.updateOne(
      { _id: l._id, status: "delivery_confirmed", hold: null, superseded: false },
      {
        $set: { status: "eligible", eligibleAt: now, deliveredAt: r.deliveredAt },
        $push: { statusHistory: { status: "eligible", at: now, by: null, reason: `delivered, paid, ${settings.eligibilityHoldDays}-day hold passed` } },
      }
    );
    out.madeEligible += u.modifiedCount;
  }
  return out;
}

let eligibilityRunning = false;
// Hourly, first run 2 minutes after start. Best-effort: never throws.
export function startEligibilityJob() {
  const run = async () => {
    if (eligibilityRunning || mongoose.connection.readyState !== 1) return;
    eligibilityRunning = true;
    try {
      const r = await runEligibility();
      if (r.madeEligible) console.log(`[ambassador] eligibility: ${r.madeEligible} commission line(s) now eligible`);
    } catch (err: any) {
      console.error("[ambassador] eligibility run failed:", err?.message || err);
    } finally {
      eligibilityRunning = false;
    }
  };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}

// ---- clawbacks ------------------------------------------------------------

// Order reversed after its commission went into a payout (processing) or was
// paid: the paid record stays as it is and a negative adjustment nets it off
// the partner's next payout. One per line (unique index), so replays are safe.
export async function clawbackOrderCommissions(orderId: Types.ObjectId, reason: string): Promise<number> {
  const lines = await AmbassadorCommission.find({ orderId, superseded: false, status: { $in: ["processing", "paid"] } })
    .select("_id ambassadorId commissionPaise orderNumber status")
    .lean();
  let created = 0;
  for (const l of lines) {
    if (!l.commissionPaise) continue;
    try {
      const r = await AmbassadorAdjustment.updateOne(
        { commissionId: l._id, kind: "clawback" },
        {
          $setOnInsert: {
            ambassadorId: l.ambassadorId,
            kind: "clawback",
            amountPaise: -l.commissionPaise,
            reason: `Clawback: ${reason} (order ${l.orderNumber}, commission ${l.status} when reversed)`,
            commissionId: l._id,
            orderNumber: l.orderNumber,
            status: "open",
            createdBy: null,
          },
        },
        { upsert: true }
      );
      created += r.upsertedCount;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  }
  return created;
}

// ---- payout batches ------------------------------------------------------

export interface ReadyRow {
  ambassadorId: Types.ObjectId;
  fullName: string;
  partnerCode: string;
  partnerStatus: string;
  method: "upi" | "bank" | null;
  destinationMasked: string | null;
  commissionCount: number;
  adjustmentCount: number;
  totals: ReturnType<typeof payoutTotals>;
  payable: boolean;
  blockedReason?: string;
}

export async function readyToPay(onlyIds?: string[]): Promise<ReadyRow[]> {
  const settings = await getSettings();
  const match: any = { status: "approved", superseded: false, hold: null };
  const adjMatch: any = { status: "open" };
  if (onlyIds?.length) {
    const ids = onlyIds.map((i) => new Types.ObjectId(i));
    match.ambassadorId = { $in: ids };
    adjMatch.ambassadorId = { $in: ids };
  }
  const [comms, adjs] = await Promise.all([
    AmbassadorCommission.find(match).select("_id ambassadorId commissionPaise").lean(),
    AmbassadorAdjustment.find(adjMatch).select("_id ambassadorId amountPaise").lean(),
  ]);
  const byPartner = new Map<string, { c: any[]; a: any[] }>();
  for (const c of comms) {
    const k = String(c.ambassadorId);
    if (!byPartner.has(k)) byPartner.set(k, { c: [], a: [] });
    byPartner.get(k)!.c.push(c);
  }
  for (const a of adjs) {
    const k = String(a.ambassadorId);
    if (!byPartner.has(k)) byPartner.set(k, { c: [], a: [] });
    byPartner.get(k)!.a.push(a);
  }
  const partners = await AmbassadorProfile.find({ _id: { $in: [...byPartner.keys()] } }).select("fullName partnerCode status payout.method payout.masked").lean();
  return partners
    .map((p: any) => {
      const g = byPartner.get(String(p._id))!;
      const totals = payoutTotals(g.c.map((c) => c.commissionPaise), g.a.map((a) => a.amountPaise), settings.tdsPercent);
      let blockedReason: string | undefined;
      if (!g.c.length && !g.a.some((a) => a.amountPaise > 0)) blockedReason = "nothing approved";
      else if (totals.netPaise <= 0) blockedReason = "adjustments exceed approved commission (carried forward)";
      else if (!p.payout?.method || !p.payout?.masked) blockedReason = "no payout details";
      return {
        ambassadorId: p._id,
        fullName: p.fullName,
        partnerCode: p.partnerCode,
        partnerStatus: p.status,
        method: p.payout?.method || null,
        destinationMasked: p.payout?.masked || null,
        commissionCount: g.c.length,
        adjustmentCount: g.a.length,
        totals,
        payable: !blockedReason,
        blockedReason,
      };
    })
    .sort((a, b) => b.totals.netPaise - a.totals.netPaise);
}

export class PayoutError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

// Creates one payout per payable partner. The same Idempotency-Key always
// returns the same payouts instead of creating new ones.
export async function createPayoutBatch(opts: { batchKey: string; ambassadorIds?: string[]; by: Types.ObjectId }) {
  const existing = await AmbassadorPayout.find({ batchKey: opts.batchKey }).lean();
  if (existing.length) return { replay: true, created: existing, skipped: [] as { partnerCode: string; reason: string }[] };

  const rows = await readyToPay(opts.ambassadorIds);
  const created: any[] = [];
  const skipped: { partnerCode: string; reason: string }[] = [];
  const settings = await getSettings();
  for (const row of rows) {
    if (!row.payable) {
      skipped.push({ partnerCode: row.partnerCode, reason: row.blockedReason || "not payable" });
      continue;
    }
    const payoutNumber = formatPayoutNumber(await nextSeq("ambassador_payout"));
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Re-read inside the transaction so totals match exactly what is moved.
        const comms = await AmbassadorCommission.find({ ambassadorId: row.ambassadorId, status: "approved", superseded: false, hold: null }).select("_id commissionPaise").session(session).lean();
        const adjs = await AmbassadorAdjustment.find({ ambassadorId: row.ambassadorId, status: "open" }).select("_id amountPaise").session(session).lean();
        const t = payoutTotals(comms.map((c) => c.commissionPaise), adjs.map((a) => a.amountPaise), settings.tdsPercent);
        if (t.netPaise <= 0) throw new PayoutError("changed");
        const now = new Date();
        const _id = new Types.ObjectId();
        const doc: any = {
              _id,
              payoutNumber,
              batchKey: opts.batchKey,
              ambassadorId: row.ambassadorId,
              partnerCode: row.partnerCode,
              method: row.method,
              destinationMasked: row.destinationMasked,
              commissionIds: comms.map((c) => c._id),
              adjustmentIds: adjs.map((a) => a._id),
              ...t,
              status: "processing",
              createdBy: opts.by,
              statusHistory: [{ status: "processing", at: now, by: opts.by, note: "batch created" }],
        };
        await AmbassadorPayout.create([doc], { session });
        const cu = await AmbassadorCommission.updateMany(
          { _id: { $in: comms.map((c) => c._id) }, status: "approved" },
          { $set: { status: "processing", payoutId: _id }, $push: { statusHistory: { status: "processing", at: now, by: opts.by, reason: `payout ${payoutNumber}` } } },
          { session }
        );
        const au = await AmbassadorAdjustment.updateMany({ _id: { $in: adjs.map((a) => a._id) }, status: "open" }, { $set: { status: "in_payout", payoutId: _id } }, { session });
        if (cu.modifiedCount !== comms.length || au.modifiedCount !== adjs.length) throw new PayoutError("changed");
      });
      created.push(await AmbassadorPayout.findOne({ batchKey: opts.batchKey, ambassadorId: row.ambassadorId }).lean());
    } catch (err: any) {
      if (err?.code === 11000) {
        // A concurrent request with the same key created it first.
        const p = await AmbassadorPayout.findOne({ batchKey: opts.batchKey, ambassadorId: row.ambassadorId }).lean();
        if (p) created.push(p);
      } else if (err instanceof PayoutError) {
        skipped.push({ partnerCode: row.partnerCode, reason: "commissions changed while creating the payout; try again" });
      } else throw err;
    } finally {
      await session.endSession();
    }
  }
  return { replay: false, created, skipped };
}

export async function markPayoutPaid(payoutId: string, reference: string, paidAt: Date, by: Types.ObjectId) {
  const p = await AmbassadorPayout.findById(payoutId).lean();
  if (!p) throw new PayoutError("Payout not found", 404);
  if (p.status === "paid") {
    if (p.reference === reference) return { payout: p, alreadyPaid: true };
    throw new PayoutError(`Already marked paid with reference ${p.reference}. A paid payout can't be changed; record an adjustment instead.`);
  }
  if (p.status !== "processing") throw new PayoutError(`A ${p.status} payout can't be marked paid`);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const r = await AmbassadorPayout.updateOne(
        { _id: p._id, status: "processing" },
        { $set: { status: "paid", reference, paidAt, paidBy: by }, $push: { statusHistory: { status: "paid", at: new Date(), by, note: reference } } },
        { session }
      );
      if (r.modifiedCount !== 1) throw new PayoutError("The payout changed in the meantime; reload");
      await AmbassadorCommission.updateMany(
        { payoutId: p._id, status: "processing" },
        { $set: { status: "paid", paidAt }, $push: { statusHistory: { status: "paid", at: new Date(), by, reason: `payout ${p.payoutNumber} · ${reference}` } } },
        { session }
      );
      await AmbassadorAdjustment.updateMany({ payoutId: p._id, status: "in_payout" }, { $set: { status: "settled" } }, { session });
    });
  } finally {
    await session.endSession();
  }
  return { payout: await AmbassadorPayout.findById(p._id).lean(), alreadyPaid: false };
}

// Failed transfer: commissions go back to approved (to be re-batched) and
// adjustments back to open — except a line whose order was reversed while the
// payout was in flight: that line is reversed and its clawback voided, so it
// is neither paid nor clawed back.
export async function markPayoutFailed(payoutId: string, reason: string, by: Types.ObjectId) {
  const p = await AmbassadorPayout.findById(payoutId).lean();
  if (!p) throw new PayoutError("Payout not found", 404);
  if (p.status !== "processing") throw new PayoutError(`A ${p.status} payout can't be marked failed`);
  const now = new Date();
  const session = await mongoose.startSession();
  let reversedLines = 0;
  try {
    await session.withTransaction(async () => {
      reversedLines = 0;
      const r = await AmbassadorPayout.updateOne(
        { _id: p._id, status: "processing" },
        { $set: { status: "failed", failedAt: now, failureReason: reason }, $push: { statusHistory: { status: "failed", at: now, by, note: reason } } },
        { session }
      );
      if (r.modifiedCount !== 1) throw new PayoutError("The payout changed in the meantime; reload");
      const clawbacks = await AmbassadorAdjustment.find({ kind: "clawback", commissionId: { $in: p.commissionIds }, status: "open" }).session(session).lean();
      const clawed = new Set(clawbacks.map((c) => String(c.commissionId)));
      if (clawbacks.length) {
        await AmbassadorAdjustment.updateMany(
          { _id: { $in: clawbacks.map((c) => c._id) } },
          { $set: { status: "void", voidedAt: now, voidedBy: by, voidReason: `payout ${p.payoutNumber} failed; commission reversed instead` } },
          { session }
        );
        const rv = await AmbassadorCommission.updateMany(
          { _id: { $in: [...clawed].map((i) => new Types.ObjectId(i)) }, payoutId: p._id, status: "processing" },
          {
            $set: { status: "reversed", reversedAt: now, reversalReason: "order reversed while payout was in progress" },
            $unset: { payoutId: "" },
            $push: { statusHistory: { status: "reversed", at: now, by, reason: `payout ${p.payoutNumber} failed; order had been reversed` } },
          },
          { session }
        );
        reversedLines = rv.modifiedCount;
      }
      await AmbassadorCommission.updateMany(
        { payoutId: p._id, status: "processing" },
        { $set: { status: "approved" }, $unset: { payoutId: "" }, $push: { statusHistory: { status: "approved", at: now, by, reason: `payout ${p.payoutNumber} failed: ${reason}` } } },
        { session }
      );
      await AmbassadorAdjustment.updateMany({ payoutId: p._id, status: "in_payout" }, { $set: { status: "open" }, $unset: { payoutId: "" } }, { session });
    });
  } finally {
    await session.endSession();
  }
  return { payout: await AmbassadorPayout.findById(p._id).lean(), reversedLines };
}

// ---- reconciliation -------------------------------------------------------

// Every payout in the window, recomputed from the lines it claims to cover.
// `consistent` is false if anything doesn't add up.
export async function reconciliation(from: Date, to: Date) {
  const payouts = await AmbassadorPayout.find({ createdAt: { $gte: from, $lt: to } }).sort({ createdAt: 1 }).lean();
  const commIds = payouts.flatMap((p) => p.commissionIds);
  const adjIds = payouts.flatMap((p) => p.adjustmentIds);
  const [comms, adjs] = await Promise.all([
    AmbassadorCommission.find({ _id: { $in: commIds } }).select("_id commissionPaise status payoutId orderNumber").lean(),
    AmbassadorAdjustment.find({ _id: { $in: adjIds } }).select("_id amountPaise status payoutId").lean(),
  ]);
  const cById = new Map(comms.map((c: any) => [String(c._id), c]));
  const aById = new Map(adjs.map((a: any) => [String(a._id), a]));
  const rows = payouts.map((p) => {
    const cs = p.commissionIds.map((i) => cById.get(String(i))).filter(Boolean) as any[];
    const as = p.adjustmentIds.map((i) => aById.get(String(i))).filter(Boolean) as any[];
    const gross = cs.reduce((s, c) => s + c.commissionPaise, 0);
    const adj = as.reduce((s, a) => s + a.amountPaise, 0);
    const problems: string[] = [];
    if (cs.length !== p.commissionIds.length || as.length !== p.adjustmentIds.length) problems.push("missing lines");
    if (gross !== p.grossPaise) problems.push("gross mismatch");
    if (adj !== p.adjustmentsPaise) problems.push("adjustments mismatch");
    if (p.grossPaise + p.adjustmentsPaise - p.tdsPaise !== p.netPaise) problems.push("net mismatch");
    if (p.status === "paid") {
      if (!p.reference) problems.push("paid without reference");
      if (cs.some((c) => c.status !== "paid" || String(c.payoutId) !== String(p._id))) problems.push("line not marked paid");
      if (as.some((a) => a.status !== "settled")) problems.push("adjustment not settled");
    }
    if (p.status === "processing" && cs.some((c) => c.status !== "processing")) problems.push("line status mismatch");
    return {
      _id: p._id,
      payoutNumber: p.payoutNumber,
      partnerCode: p.partnerCode,
      status: p.status,
      method: p.method,
      destinationMasked: p.destinationMasked,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      reference: p.reference,
      lines: cs.length,
      adjustmentLines: as.length,
      grossPaise: p.grossPaise,
      adjustmentsPaise: p.adjustmentsPaise,
      tdsPaise: p.tdsPaise,
      netPaise: p.netPaise,
      consistent: problems.length === 0,
      problems,
    };
  });
  const sum = (st: string | null, k: "grossPaise" | "adjustmentsPaise" | "tdsPaise" | "netPaise") => rows.filter((r) => !st || r.status === st).reduce((s, r) => s + r[k], 0);
  return {
    rows,
    totals: {
      count: rows.length,
      paid: { count: rows.filter((r) => r.status === "paid").length, netPaise: sum("paid", "netPaise"), tdsPaise: sum("paid", "tdsPaise") },
      processing: { count: rows.filter((r) => r.status === "processing").length, netPaise: sum("processing", "netPaise") },
      failed: { count: rows.filter((r) => r.status === "failed").length, netPaise: sum("failed", "netPaise") },
      inconsistent: rows.filter((r) => !r.consistent).length,
    },
  };
}
