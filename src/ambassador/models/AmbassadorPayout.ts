import mongoose, { Schema, Document, Types } from "mongoose";

// One payout = one transfer to one partner, covering approved commission
// lines plus any open adjustments (clawbacks are negative). Created by
// finance in a batch (Idempotency-Key), then marked paid with the bank/UPI
// reference, or failed. A paid payout is never edited; later corrections are
// new adjustments. Money in integer paise.
export const PAYOUT_STATUSES = ["processing", "paid", "failed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export interface IAmbassadorPayout extends Document {
  _id: Types.ObjectId;
  payoutNumber: string;
  batchKey: string;
  ambassadorId: Types.ObjectId;
  partnerCode: string;
  method: "upi" | "bank";
  destinationMasked: string;
  commissionIds: Types.ObjectId[];
  adjustmentIds: Types.ObjectId[];
  grossPaise: number;
  adjustmentsPaise: number; // signed
  tdsPercent: number;
  tdsPaise: number;
  netPaise: number;
  status: PayoutStatus;
  reference?: string;
  paidAt?: Date;
  paidBy?: Types.ObjectId;
  failedAt?: Date;
  failureReason?: string;
  createdBy: Types.ObjectId;
  statusHistory: { status: string; at: Date; by?: Types.ObjectId | null; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const int = { validator: Number.isSafeInteger, message: "must be whole paise" };

const AmbassadorPayoutSchema = new Schema<IAmbassadorPayout>(
  {
    payoutNumber: { type: String, required: true, unique: true },
    batchKey: { type: String, required: true },
    ambassadorId: { type: Schema.Types.ObjectId, ref: "AmbassadorProfile", required: true },
    partnerCode: { type: String, required: true },
    method: { type: String, enum: ["upi", "bank"], required: true },
    destinationMasked: { type: String, required: true },
    commissionIds: { type: [Schema.Types.ObjectId], default: [] },
    adjustmentIds: { type: [Schema.Types.ObjectId], default: [] },
    grossPaise: { type: Number, required: true, min: 0, validate: int },
    adjustmentsPaise: { type: Number, required: true, validate: int },
    tdsPercent: { type: Number, required: true, min: 0, max: 30 },
    tdsPaise: { type: Number, required: true, min: 0, validate: int },
    netPaise: { type: Number, required: true, min: 1, validate: int },
    status: { type: String, enum: PAYOUT_STATUSES, default: "processing" },
    reference: String,
    paidAt: Date,
    paidBy: { type: Schema.Types.ObjectId, ref: "User" },
    failedAt: Date,
    failureReason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    statusHistory: {
      type: [{ status: String, at: Date, by: { type: Schema.Types.ObjectId, default: null }, note: String, _id: false }],
      default: [],
    },
  },
  { timestamps: true }
);

// A repeated batch request (same Idempotency-Key) can never pay a partner twice.
AmbassadorPayoutSchema.index({ batchKey: 1, ambassadorId: 1 }, { unique: true });
AmbassadorPayoutSchema.index({ ambassadorId: 1, createdAt: -1 });
AmbassadorPayoutSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IAmbassadorPayout>("AmbassadorPayout", AmbassadorPayoutSchema);
