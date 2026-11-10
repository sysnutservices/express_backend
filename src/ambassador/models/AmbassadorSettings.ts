import mongoose, { Schema, Types } from "mongoose";

export interface IAmbassadorSettings {
  _id: Types.ObjectId;
  key: "default";
  programmeEnabled: boolean;
  registrationOpen: boolean;
  pilotAllowlist: string[]; // 10-digit mobiles allowed to register while registrationOpen is false
  leadOwnershipDays: number;
  eligibilityHoldDays: number;
  quotationValidityHours: number;
  minimumAge: number;
  agreementVersion: string;
  referralBaseUrl: string;
  // Size of the founding (pilot) cohort shown as a live counter on /partner.
  // A real operational limit, not decoration: it is how many partners the
  // owner wants to validate the economics with before scaling (docs/08).
  foundingCohortSize: number;
  // TDS deducted from payouts. 0 until the accountant confirms the treatment (decisions Q7).
  tdsPercent: number;
  updatedBy?: Types.ObjectId;
}

export const SETTINGS_DEFAULTS = {
  programmeEnabled: false,
  registrationOpen: false,
  pilotAllowlist: [] as string[],
  leadOwnershipDays: 30,
  eligibilityHoldDays: 14,
  quotationValidityHours: 24,
  minimumAge: 18,
  agreementVersion: "2026-11-draft",
  referralBaseUrl: "https://lapshark.com/",
  foundingCohortSize: 20,
  tdsPercent: 0,
};

const AmbassadorSettingsSchema = new Schema<IAmbassadorSettings>(
  {
    key: { type: String, enum: ["default"], default: "default", unique: true },
    programmeEnabled: { type: Boolean, default: SETTINGS_DEFAULTS.programmeEnabled },
    registrationOpen: { type: Boolean, default: SETTINGS_DEFAULTS.registrationOpen },
    pilotAllowlist: { type: [String], default: [] },
    leadOwnershipDays: { type: Number, min: 1, max: 365, default: SETTINGS_DEFAULTS.leadOwnershipDays },
    eligibilityHoldDays: { type: Number, min: 0, max: 90, default: SETTINGS_DEFAULTS.eligibilityHoldDays },
    quotationValidityHours: { type: Number, min: 1, max: 720, default: SETTINGS_DEFAULTS.quotationValidityHours },
    minimumAge: { type: Number, min: 18, max: 100, default: SETTINGS_DEFAULTS.minimumAge },
    agreementVersion: { type: String, default: SETTINGS_DEFAULTS.agreementVersion },
    referralBaseUrl: { type: String, default: SETTINGS_DEFAULTS.referralBaseUrl },
    foundingCohortSize: { type: Number, min: 0, max: 10000, default: SETTINGS_DEFAULTS.foundingCohortSize },
    tdsPercent: { type: Number, min: 0, max: 30, default: SETTINGS_DEFAULTS.tdsPercent },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model<IAmbassadorSettings>("AmbassadorSettings", AmbassadorSettingsSchema);
