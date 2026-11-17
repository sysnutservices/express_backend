import mongoose, { Schema, Types } from "mongoose";

export interface IDealerSettings {
  _id: Types.ObjectId;
  key: "default";
  enabled: boolean; // master switch for every dealer endpoint
  registrationOpen: boolean;
  agreementVersion: string;
  // Days after delivery a dealer can report transit damage or a laptop that
  // doesn't match the order. Owner decision 2026-11-17: 7.
  claimWindowDays: number;
  // Cash must stay BELOW this per order and per dealer per day. Income Tax
  // Act s.269ST bars receiving Rs 2,00,000 or more in cash from one person in
  // a day or for one transaction.
  cashLimitPaise: number;
  // Shown to dealers on unpaid orders. Empty until the owner fills them in:
  // bank details are never invented.
  bankTransferInstructions: string;
  pickupInstructions: string;
  updatedBy?: Types.ObjectId;
}

export const DEALER_SETTINGS_DEFAULTS = {
  enabled: false,
  registrationOpen: false,
  agreementVersion: "2026-11-dealer-draft",
  claimWindowDays: 7,
  cashLimitPaise: 200000 * 100,
  bankTransferInstructions: "",
  pickupInstructions: "",
};

export const EDITABLE_DEALER_SETTINGS = Object.keys(DEALER_SETTINGS_DEFAULTS) as (keyof typeof DEALER_SETTINGS_DEFAULTS)[];

const DealerSettingsSchema = new Schema<IDealerSettings>(
  {
    key: { type: String, enum: ["default"], default: "default", unique: true },
    enabled: Boolean,
    registrationOpen: Boolean,
    agreementVersion: String,
    claimWindowDays: Number,
    cashLimitPaise: Number,
    bankTransferInstructions: String,
    pickupInstructions: String,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model<IDealerSettings>("DealerSettings", DealerSettingsSchema);
