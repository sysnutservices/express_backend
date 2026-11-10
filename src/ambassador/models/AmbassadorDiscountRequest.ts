import mongoose, { Schema, Document, Types } from "mongoose";

// Level 3 "special approval": a quotation with one or more lines below the
// partner's floor (or with no floor configured) waits here for an admin.
// One request per quotation version. Money in integer paise.
export const DISCOUNT_REQUEST_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type DiscountRequestStatus = (typeof DISCOUNT_REQUEST_STATUSES)[number];

export interface IDiscountLine {
  itemId: Types.ObjectId; // AmbassadorQuotation.items[]._id
  title: string;
  quantity: number;
  listedUnitPaise: number;
  floorUnitPaise: number | null;
  requestedUnitPaise: number;
  estCommissionPerUnitPaise: number; // what the rule alone would pay (usually 0 below floor)
  approvedCommissionPerUnitPaise: number | null;
}

export interface IAmbassadorDiscountRequest extends Document {
  _id: Types.ObjectId;
  quotationId: Types.ObjectId;
  quoteNumber: string;
  quoteVersion: number;
  ambassadorId: Types.ObjectId;
  lines: IDiscountLine[];
  reason: string;
  status: DiscountRequestStatus;
  decision?: { by: Types.ObjectId; at: Date; note?: string };
  createdAt: Date;
  updatedAt: Date;
}

const paise = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };

const AmbassadorDiscountRequestSchema = new Schema<IAmbassadorDiscountRequest>(
  {
    quotationId: { type: Schema.Types.ObjectId, ref: "AmbassadorQuotation", required: true },
    quoteNumber: { type: String, required: true },
    quoteVersion: { type: Number, required: true },
    ambassadorId: { type: Schema.Types.ObjectId, ref: "AmbassadorProfile", required: true },
    lines: [
      {
        itemId: { type: Schema.Types.ObjectId, required: true },
        title: { type: String, required: true },
        quantity: { type: Number, required: true },
        listedUnitPaise: paise,
        floorUnitPaise: { type: Number, default: null },
        requestedUnitPaise: paise,
        estCommissionPerUnitPaise: paise,
        approvedCommissionPerUnitPaise: { type: Number, default: null },
        _id: false,
      },
    ],
    reason: { type: String, required: true },
    status: { type: String, enum: DISCOUNT_REQUEST_STATUSES, default: "pending" },
    decision: {
      type: new Schema({ by: { type: Schema.Types.ObjectId, required: true }, at: { type: Date, required: true }, note: String }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true }
);

AmbassadorDiscountRequestSchema.index({ quotationId: 1 }, { unique: true });
AmbassadorDiscountRequestSchema.index({ status: 1, createdAt: -1 });
AmbassadorDiscountRequestSchema.index({ ambassadorId: 1, createdAt: -1 });

export default mongoose.model<IAmbassadorDiscountRequest>("AmbassadorDiscountRequest", AmbassadorDiscountRequestSchema);
