import mongoose, { Schema, Document, Types } from "mongoose";

export const PARTNER_STATUSES = [
  "application_submitted",
  "verification_pending",
  "approved",
  "active",
  "suspended",
  "rejected",
  "terminated",
] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export interface IAmbassadorProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  partnerCode: string;
  partnerType: "referral" | "independent";
  status: PartnerStatus;
  statusHistory: { status: PartnerStatus; at: Date; by?: Types.ObjectId | null; reason?: string }[];
  fullName: string;
  email: string;
  emailVerifiedAt?: Date;
  phone: string;
  dateOfBirth: Date;
  address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  city: string;
  state: string;
  business?: { name?: string; gstin?: string };
  occupation?: string;
  heardFrom?: string;
  pan: { encrypted: string; last4: string };
  panHash: string;
  payout: { method: "upi" | "bank"; encrypted: string; masked: string };
  payoutHash: string;
  agreement: { version: string; acceptedAt: Date; ip?: string };
  agreementHistory: { version: string; acceptedAt: Date; ip?: string }[];
  orientationCompletedAt?: Date;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  suspensionReason?: string;
  flags: { type: string; detail?: string; at: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

const AmbassadorProfileSchema = new Schema<IAmbassadorProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    partnerCode: { type: String, required: true, unique: true },
    partnerType: { type: String, enum: ["referral", "independent"], required: true },
    status: { type: String, enum: PARTNER_STATUSES, required: true, default: "application_submitted" },
    statusHistory: {
      type: [
        {
          status: { type: String, enum: PARTNER_STATUSES, required: true },
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: "User", default: null },
          reason: String,
          _id: false,
        },
      ],
      default: [],
    },
    fullName: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    emailVerifiedAt: Date,
    phone: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    dateOfBirth: { type: Date, required: true },
    address: {
      line1: { type: String, required: true },
      line2: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    city: { type: String, required: true, index: true },
    state: { type: String, required: true },
    business: { name: String, gstin: String },
    occupation: String,
    heardFrom: String,
    // Sensitive: ciphertext only. Never select these into partner/admin
    // list responses — see toPartnerView/toAdminView in services/views.ts.
    pan: {
      encrypted: { type: String, required: true },
      last4: { type: String, required: true },
    },
    panHash: { type: String, required: true, unique: true },
    payout: {
      method: { type: String, enum: ["upi", "bank"], required: true },
      encrypted: { type: String, required: true },
      masked: { type: String, required: true },
    },
    payoutHash: { type: String, required: true, index: true },
    agreement: {
      version: { type: String, required: true },
      acceptedAt: { type: Date, required: true },
      ip: String,
    },
    agreementHistory: { type: [{ version: String, acceptedAt: Date, ip: String, _id: false }], default: [] },
    orientationCompletedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    rejectionReason: String,
    suspensionReason: String,
    flags: { type: [{ type: { type: String }, detail: String, at: Date, _id: false }], default: [] },
  },
  { timestamps: true }
);

AmbassadorProfileSchema.index({ status: 1, partnerType: 1, createdAt: -1 });

export default mongoose.model<IAmbassadorProfile>("AmbassadorProfile", AmbassadorProfileSchema);
