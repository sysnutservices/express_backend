import mongoose, { Schema, Document, Types } from "mongoose";

// A trade buyer (dealer/reseller) who buys laptops from Lapshark and resells
// them under its own name. One per User (same WhatsApp-OTP login as everyone
// else). See distribution/docs/13-dealer-channel.md.
export const DEALER_STATUSES = ["applied", "approved", "suspended", "rejected"] as const;
export type DealerStatus = (typeof DEALER_STATUSES)[number];

export interface IDealerProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  dealerCode: string;
  status: DealerStatus;
  statusHistory: { status: DealerStatus; at: Date; by?: Types.ObjectId | null; reason?: string }[];
  businessName: string;
  contactName: string;
  phone: string;
  email?: string;
  address: { line1: string; line2?: string; city: string; state: string; pincode: string };
  // Sensitive: ciphertext + last 4 only. GSTIN and PAN are each optional but
  // at least one is required (validated in logic.ts).
  gstin?: { encrypted: string; last4: string };
  gstinHash?: string;
  pan?: { encrypted: string; last4: string };
  panHash?: string;
  agreement: { version: string; acceptedAt: Date; ip?: string; noWarrantyAcknowledged: boolean };
  flags: { type: string; detail?: string; at: Date }[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DealerProfileSchema = new Schema<IDealerProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    dealerCode: { type: String, required: true, unique: true },
    status: { type: String, enum: DEALER_STATUSES, required: true, default: "applied" },
    statusHistory: {
      type: [
        {
          status: { type: String, enum: DEALER_STATUSES, required: true },
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: "User", default: null },
          reason: String,
          _id: false,
        },
      ],
      default: [],
    },
    businessName: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    email: { type: String, lowercase: true, trim: true },
    address: {
      line1: { type: String, required: true },
      line2: String,
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
    },
    gstin: { type: { encrypted: String, last4: String, _id: false }, default: undefined },
    pan: { type: { encrypted: String, last4: String, _id: false }, default: undefined },
    // Partial unique indexes below: an unset hash never collides.
    gstinHash: { type: String },
    panHash: { type: String },
    agreement: {
      version: { type: String, required: true },
      acceptedAt: { type: Date, required: true },
      ip: String,
      noWarrantyAcknowledged: { type: Boolean, required: true },
    },
    flags: { type: [{ type: { type: String }, detail: String, at: Date, _id: false }], default: [] },
    notes: String,
  },
  { timestamps: true }
);

DealerProfileSchema.index({ gstinHash: 1 }, { unique: true, partialFilterExpression: { gstinHash: { $type: "string" } } });
DealerProfileSchema.index({ panHash: 1 }, { unique: true, partialFilterExpression: { panHash: { $type: "string" } } });
DealerProfileSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IDealerProfile>("DealerProfile", DealerProfileSchema);
