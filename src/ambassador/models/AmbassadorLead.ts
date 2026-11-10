import mongoose, { Schema, Document, Types } from "mongoose";
import { LEAD_STATUSES, CUSTOMER_TYPES, LeadStatus } from "../validation";

export interface IAmbassadorLead extends Document {
  _id: Types.ObjectId;
  ambassadorId: Types.ObjectId;
  customerName: string;
  phone: string;
  email?: string;
  location?: string;
  customerType: (typeof CUSTOMER_TYPES)[number];
  requirements?: string;
  preferredSpecs?: string;
  budgetPaise?: number;
  source?: string;
  status: LeadStatus;
  consent: { given: boolean; at: Date; method: string };
  followUpAt?: Date | null;
  notes?: string;
  lostReason?: string;
  ownershipExpiresAt: Date;
  existingCustomer: boolean;
  wonOrderId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AmbassadorLeadSchema = new Schema<IAmbassadorLead>(
  {
    ambassadorId: { type: Schema.Types.ObjectId, ref: "AmbassadorProfile", required: true },
    customerName: { type: String, required: true },
    phone: { type: String, required: true, match: /^\d{10}$/ },
    email: { type: String, lowercase: true, trim: true },
    location: String,
    customerType: { type: String, enum: CUSTOMER_TYPES, default: "individual" },
    requirements: String,
    preferredSpecs: String,
    budgetPaise: { type: Number, min: 0, validate: Number.isSafeInteger },
    source: String,
    status: { type: String, enum: LEAD_STATUSES, default: "new" },
    consent: {
      given: { type: Boolean, required: true },
      at: { type: Date, required: true },
      method: { type: String, default: "partner_declared" },
    },
    followUpAt: { type: Date, default: null },
    notes: String,
    lostReason: String,
    ownershipExpiresAt: { type: Date, required: true },
    existingCustomer: { type: Boolean, default: false },
    wonOrderId: { type: Schema.Types.ObjectId, ref: "Order" },
  },
  { timestamps: true }
);

AmbassadorLeadSchema.index({ phone: 1, ownershipExpiresAt: -1 });
AmbassadorLeadSchema.index({ ambassadorId: 1, status: 1 });
AmbassadorLeadSchema.index({ ambassadorId: 1, createdAt: -1 });
AmbassadorLeadSchema.index({ followUpAt: 1 }, { sparse: true });

export default mongoose.model<IAmbassadorLead>("AmbassadorLead", AmbassadorLeadSchema);
