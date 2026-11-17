import mongoose, { Schema, Types } from "mongoose";

// Interest from the public /dealers landing page while dealer registration is
// closed. Not an application: no login, no GSTIN/PAN, no address. Lapshark
// calls the person back; once registration opens they apply at /dealer.
// One per mobile number: a repeat submission updates the details.
export const DEALER_ENQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type DealerEnquiryStatus = (typeof DEALER_ENQUIRY_STATUSES)[number];

export interface IDealerEnquiry {
  _id: Types.ObjectId;
  phone: string;
  businessName: string;
  contactName: string;
  city: string;
  businessType: string;
  monthlyVolume: string;
  message?: string;
  consent: { given: boolean; at: Date };
  source?: { utmSource?: string; utmMedium?: string; utmCampaign?: string; referrer?: string };
  status: DealerEnquiryStatus;
  statusAt?: Date;
  statusBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const DealerEnquirySchema = new Schema<IDealerEnquiry>(
  {
    phone: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    businessName: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    businessType: { type: String, required: true },
    monthlyVolume: { type: String, required: true },
    message: String,
    consent: { given: { type: Boolean, required: true }, at: { type: Date, required: true } },
    source: { utmSource: String, utmMedium: String, utmCampaign: String, referrer: String },
    status: { type: String, enum: DEALER_ENQUIRY_STATUSES, default: "new" },
    statusAt: Date,
    statusBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

DealerEnquirySchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IDealerEnquiry>("DealerEnquiry", DealerEnquirySchema);
