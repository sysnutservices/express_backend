import mongoose, { Schema, Types } from "mongoose";

// Interest captured on the /partner landing page while registration is
// invite-only (pilot) or the programme is not yet open. Not an application:
// no PAN/payout data, no OTP. An admin "invites" an entry, which adds the
// mobile to AmbassadorSettings.pilotAllowlist so the person can then apply.
export interface IAmbassadorWaitlist {
  _id: Types.ObjectId;
  fullName: string;
  phone: string;
  email?: string;
  city?: string;
  occupation?: string;
  partnerType: "referral" | "independent";
  consent: { given: boolean; at: Date };
  source?: { utmSource?: string; utmMedium?: string; utmCampaign?: string; referrer?: string };
  status: "waiting" | "invited" | "registered";
  invitedAt?: Date;
  invitedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const AmbassadorWaitlistSchema = new Schema<IAmbassadorWaitlist>(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true, unique: true, match: /^\d{10}$/ },
    email: { type: String, lowercase: true, trim: true },
    city: String,
    occupation: String,
    partnerType: { type: String, enum: ["referral", "independent"], default: "referral" },
    consent: { given: { type: Boolean, required: true }, at: { type: Date, required: true } },
    source: { utmSource: String, utmMedium: String, utmCampaign: String, referrer: String },
    status: { type: String, enum: ["waiting", "invited", "registered"], default: "waiting" },
    invitedAt: Date,
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

AmbassadorWaitlistSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IAmbassadorWaitlist>("AmbassadorWaitlist", AmbassadorWaitlistSchema);
