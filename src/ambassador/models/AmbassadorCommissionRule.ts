import mongoose, { Schema, Types } from "mongoose";

const paise = { type: Number, min: 0, validate: { validator: (v: number | null) => v === null || Number.isSafeInteger(v), message: "must be whole paise" } };

export interface IAmbassadorCommissionRule {
  _id: Types.ObjectId;
  partnerType: "referral" | "independent";
  productId: Types.ObjectId | null;
  kind: "slab" | "margin_share";
  slabs: { minPricePaise: number; maxPricePaise: number | null; commissionPaise: number }[];
  minimumPricePaise: number | null;
  baseCommissionPaise: number | null;
  marginSharePercent: number | null;
  version: number;
  status: "active" | "retired";
  validFrom?: Date;
  validUntil?: Date;
  notes?: string;
  createdBy?: Types.ObjectId;
  retiredBy?: Types.ObjectId;
  retiredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Versioned and never edited in place: a change retires the active version
// and inserts version n+1 (see adminAmbassadorController.createRule).
const AmbassadorCommissionRuleSchema = new Schema<IAmbassadorCommissionRule>(
  {
    partnerType: { type: String, enum: ["referral", "independent"], required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    kind: { type: String, enum: ["slab", "margin_share"], required: true },
    slabs: {
      type: [
        {
          minPricePaise: { ...paise, required: true },
          maxPricePaise: { ...paise, default: null },
          commissionPaise: { ...paise, required: true },
          _id: false,
        },
      ],
      default: [],
    },
    minimumPricePaise: { ...paise, default: null },
    baseCommissionPaise: { ...paise, default: null },
    marginSharePercent: { type: Number, min: 0, max: 100, default: null },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["active", "retired"], default: "active" },
    validFrom: Date,
    validUntil: Date,
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    retiredBy: { type: Schema.Types.ObjectId, ref: "User" },
    retiredAt: Date,
  },
  { timestamps: true }
);

// At most one ACTIVE rule per (partnerType, productId) — race-proof.
AmbassadorCommissionRuleSchema.index(
  { partnerType: 1, productId: 1 },
  { unique: true, partialFilterExpression: { status: "active" }, name: "one_active_rule_per_key" }
);
AmbassadorCommissionRuleSchema.index({ partnerType: 1, productId: 1, version: -1 });

export default mongoose.model<IAmbassadorCommissionRule>("AmbassadorCommissionRule", AmbassadorCommissionRuleSchema);
