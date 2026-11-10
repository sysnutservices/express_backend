import mongoose, { Schema, Document, Types } from "mongoose";

// Ledger corrections that ride on the partner's next payout:
//   clawback  — automatic, negative: an order was cancelled/refunded/RTO'd
//               after its commission was already in a payout or paid.
//   manual    — finance, either sign, with a reason (audited).
// The amount and reason are never edited. Status only moves forward:
// open → in_payout → settled, or open → void (with a reason). A failed
// payout returns its adjustments to open.
export const ADJUSTMENT_STATUSES = ["open", "in_payout", "settled", "void"] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export interface IAmbassadorAdjustment extends Document {
  _id: Types.ObjectId;
  ambassadorId: Types.ObjectId;
  kind: "clawback" | "manual";
  amountPaise: number; // signed: negative reduces the next payout
  reason: string;
  commissionId?: Types.ObjectId;
  orderNumber?: string;
  status: AdjustmentStatus;
  payoutId?: Types.ObjectId;
  createdBy?: Types.ObjectId | null;
  voidedAt?: Date;
  voidedBy?: Types.ObjectId;
  voidReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AmbassadorAdjustmentSchema = new Schema<IAmbassadorAdjustment>(
  {
    ambassadorId: { type: Schema.Types.ObjectId, ref: "AmbassadorProfile", required: true },
    kind: { type: String, enum: ["clawback", "manual"], required: true },
    amountPaise: { type: Number, required: true, validate: { validator: (v: number) => Number.isSafeInteger(v) && v !== 0, message: "must be non-zero whole paise" } },
    reason: { type: String, required: true },
    commissionId: { type: Schema.Types.ObjectId, ref: "AmbassadorCommission" },
    orderNumber: String,
    status: { type: String, enum: ADJUSTMENT_STATUSES, default: "open" },
    payoutId: { type: Schema.Types.ObjectId, ref: "AmbassadorPayout" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    voidedAt: Date,
    voidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    voidReason: String,
  },
  { timestamps: true }
);

// At most one clawback per commission line, however often the order hook replays.
AmbassadorAdjustmentSchema.index({ commissionId: 1 }, { unique: true, partialFilterExpression: { kind: "clawback" }, name: "one_clawback_per_commission" });
AmbassadorAdjustmentSchema.index({ ambassadorId: 1, status: 1 });
AmbassadorAdjustmentSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IAmbassadorAdjustment>("AmbassadorAdjustment", AmbassadorAdjustmentSchema);
