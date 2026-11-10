import mongoose, { Schema, Types } from "mongoose";

export const COMMISSION_STATUSES = [
  "pending",
  "delivery_confirmed",
  "eligible",
  "approved",
  "processing",
  "paid",
  "reversed",
] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const HOLD_REASONS = [
  "self_referral",
  "existing_customer",
  "no_rule",
  "below_floor",
  "attribution_conflict",
  "partner_not_active",
  "manual",
] as const;

export interface IAmbassadorCommission {
  _id: Types.ObjectId;
  ambassadorId: Types.ObjectId;
  orderId: Types.ObjectId;
  orderNumber: string;
  orderItemId: Types.ObjectId;
  productId?: Types.ObjectId;
  productTitle?: string;
  quantity: number;
  unitSellingPricePaise: number;
  commissionPaise: number;
  currency: "INR";
  ruleId?: Types.ObjectId | null;
  ruleSnapshot?: Record<string, unknown> | null;
  calc: { perUnitPaise: number; reason: string };
  attribution: {
    type: "referral_link" | "lead" | "manual";
    code?: string;
    leadId?: Types.ObjectId;
    capturedAt?: Date;
    conflictWith?: Types.ObjectId[];
    evidence?: string;
  };
  status: CommissionStatus;
  statusHistory: { status: CommissionStatus; at: Date; by?: Types.ObjectId | null; reason?: string }[];
  hold: { reason: (typeof HOLD_REASONS)[number]; detail?: string; at: Date } | null;
  holdHistory: { reason: string; detail?: string; at: Date; clearedAt?: Date; clearedBy?: Types.ObjectId; note?: string }[];
  deliveredAt?: Date;
  eligibleAt?: Date;
  approvedAt?: Date;
  approvedBy?: Types.ObjectId;
  payoutId?: Types.ObjectId;
  paidAt?: Date;
  reversedAt?: Date;
  reversalReason?: string;
  // true only after an admin re-attributes the order to a different partner:
  // the old line is reversed AND superseded so a new line can take its slot.
  superseded: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const paise = { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger, message: "must be whole paise" } };

const AmbassadorCommissionSchema = new Schema<IAmbassadorCommission>(
  {
    ambassadorId: { type: Schema.Types.ObjectId, ref: "AmbassadorProfile", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true },
    orderItemId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    productTitle: String,
    quantity: { type: Number, required: true, min: 1 },
    unitSellingPricePaise: paise,
    // Gross amount. Written once at insert ($setOnInsert) and never updated —
    // corrections go to the Phase 3 ledger as adjustment entries.
    commissionPaise: paise,
    currency: { type: String, enum: ["INR"], default: "INR" },
    ruleId: { type: Schema.Types.ObjectId, ref: "AmbassadorCommissionRule", default: null },
    ruleSnapshot: { type: Schema.Types.Mixed, default: null },
    calc: { perUnitPaise: paise, reason: { type: String, required: true } },
    attribution: {
      type: { type: String, enum: ["referral_link", "lead", "manual"], required: true },
      code: String,
      leadId: { type: Schema.Types.ObjectId, ref: "AmbassadorLead" },
      capturedAt: Date,
      conflictWith: [{ type: Schema.Types.ObjectId, ref: "AmbassadorProfile" }],
      evidence: String,
    },
    status: { type: String, enum: COMMISSION_STATUSES, default: "pending" },
    statusHistory: {
      type: [{ status: { type: String, enum: COMMISSION_STATUSES }, at: Date, by: { type: Schema.Types.ObjectId, default: null }, reason: String, _id: false }],
      default: [],
    },
    hold: {
      type: new Schema({ reason: { type: String, enum: HOLD_REASONS, required: true }, detail: String, at: { type: Date, required: true } }, { _id: false }),
      default: null,
    },
    holdHistory: {
      type: [{ reason: String, detail: String, at: Date, clearedAt: Date, clearedBy: Schema.Types.ObjectId, note: String, _id: false }],
      default: [],
    },
    deliveredAt: Date,
    eligibleAt: Date,
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    payoutId: { type: Schema.Types.ObjectId, ref: "AmbassadorPayout" },
    paidAt: Date,
    reversedAt: Date,
    reversalReason: String,
    superseded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Exactly one live commission per order line — the duplicate-prevention
// guarantee. Partial on superseded:false so a manual re-attribution (which
// supersedes the old line) can insert the replacement; nothing else ever
// sets superseded, so replays/webhook duplicates still hit this index.
AmbassadorCommissionSchema.index(
  { orderId: 1, orderItemId: 1 },
  { unique: true, partialFilterExpression: { superseded: false }, name: "one_live_commission_per_order_line" }
);
AmbassadorCommissionSchema.index({ ambassadorId: 1, status: 1, createdAt: -1 });
AmbassadorCommissionSchema.index({ status: 1, deliveredAt: 1 });
AmbassadorCommissionSchema.index({ payoutId: 1 }, { sparse: true });

export default mongoose.model<IAmbassadorCommission>("AmbassadorCommission", AmbassadorCommissionSchema);
