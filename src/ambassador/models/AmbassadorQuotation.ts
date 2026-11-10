import mongoose, { Schema, Document, Types } from "mongoose";

// One document per quotation VERSION. Revising creates a new document with
// the same quoteNumber/rootId and version + 1; the old one becomes
// "superseded" and its link stops working. Money in integer paise.
export const QUOTE_STATUSES = ["pending_approval", "active", "rejected", "superseded", "cancelled", "converted"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
// "expired" is not stored: an active quote whose validUntil has passed.

export interface IQuoteItem {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  title: string;
  slug?: string;
  image?: string;
  config: { ram?: string; storage?: string; warranty?: string };
  configLabels: string[];
  configCostPaise: number;
  listedUnitPaise: number;
  floorUnitPaise: number | null;
  quotedUnitPaise: number;
  quantity: number;
  level: 1 | 2 | 3;
  estCommissionPerUnitPaise: number;
  calcReason: string;
  ruleId: Types.ObjectId | null;
  ruleVersion: number | null;
  // Set by an admin when approving a Level 3 (below-floor) line.
  approvedCommissionPerUnitPaise: number | null;
}

export interface IAmbassadorQuotation extends Document {
  _id: Types.ObjectId;
  quoteNumber: string;
  version: number;
  rootId: Types.ObjectId;
  previousId?: Types.ObjectId;
  supersededBy?: Types.ObjectId;
  ambassadorId: Types.ObjectId;
  leadId?: Types.ObjectId;
  customer: { name: string; phone: string; email?: string; location?: string };
  items: IQuoteItem[];
  totals: { listedPaise: number; quotedPaise: number; discountPaise: number; estCommissionPaise: number };
  customerNote?: string;
  status: QuoteStatus;
  validUntil: Date | null;
  token: string;
  discountRequestId?: Types.ObjectId;
  stockCheckedAt: Date;
  convertedOrderId?: Types.ObjectId;
  convertedOrderNumber?: string;
  convertedAt?: Date;
  statusHistory: { status: string; at: Date; by?: Types.ObjectId | null; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
}

const paise = { type: Number, required: true, min: 0, validate: Number.isSafeInteger };
const paiseOrNull = { type: Number, default: null, min: 0, validate: (v: any) => v === null || Number.isSafeInteger(v) };

const QuoteItemSchema = new Schema<IQuoteItem>({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  title: { type: String, required: true },
  slug: String,
  image: String,
  config: { ram: String, storage: String, warranty: String },
  configLabels: { type: [String], default: [] },
  configCostPaise: paise,
  listedUnitPaise: paise,
  floorUnitPaise: paiseOrNull,
  quotedUnitPaise: paise,
  quantity: { type: Number, required: true, min: 1, max: 5 },
  level: { type: Number, enum: [1, 2, 3], required: true },
  estCommissionPerUnitPaise: paise,
  calcReason: { type: String, required: true },
  ruleId: { type: Schema.Types.ObjectId, default: null },
  ruleVersion: { type: Number, default: null },
  approvedCommissionPerUnitPaise: paiseOrNull,
});

const AmbassadorQuotationSchema = new Schema<IAmbassadorQuotation>(
  {
    quoteNumber: { type: String, required: true },
    version: { type: Number, required: true, min: 1 },
    rootId: { type: Schema.Types.ObjectId, required: true },
    previousId: { type: Schema.Types.ObjectId },
    supersededBy: { type: Schema.Types.ObjectId },
    ambassadorId: { type: Schema.Types.ObjectId, ref: "AmbassadorProfile", required: true },
    leadId: { type: Schema.Types.ObjectId, ref: "AmbassadorLead" },
    customer: {
      name: { type: String, required: true },
      phone: { type: String, required: true, match: /^\d{10}$/ },
      email: String,
      location: String,
    },
    items: { type: [QuoteItemSchema], validate: (v: unknown[]) => v.length >= 1 && v.length <= 10 },
    totals: { listedPaise: paise, quotedPaise: paise, discountPaise: paise, estCommissionPaise: paise },
    customerNote: String,
    status: { type: String, enum: QUOTE_STATUSES, required: true },
    validUntil: { type: Date, default: null },
    // Bearer capability for the customer's link (/quote/<token>). Not a
    // secret worth encrypting: it only lets someone buy at the quoted price
    // until validUntil. Excluded from default reads anyway.
    token: { type: String, required: true, select: false },
    discountRequestId: { type: Schema.Types.ObjectId, ref: "AmbassadorDiscountRequest" },
    stockCheckedAt: { type: Date, required: true },
    convertedOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
    convertedOrderNumber: String,
    convertedAt: Date,
    statusHistory: {
      type: [{ status: String, at: Date, by: { type: Schema.Types.ObjectId, default: null }, note: String, _id: false }],
      default: [],
    },
  },
  { timestamps: true }
);

AmbassadorQuotationSchema.index({ token: 1 }, { unique: true });
AmbassadorQuotationSchema.index({ quoteNumber: 1, version: 1 }, { unique: true });
AmbassadorQuotationSchema.index({ ambassadorId: 1, createdAt: -1 });
AmbassadorQuotationSchema.index({ rootId: 1, version: -1 });
AmbassadorQuotationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IAmbassadorQuotation>("AmbassadorQuotation", AmbassadorQuotationSchema);
