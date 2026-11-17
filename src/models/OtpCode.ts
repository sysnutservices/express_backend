import mongoose, { Schema } from "mongoose";

// One pending login OTP per mobile, replacing the old in-memory Map in
// authController (which kept codes in plain text and lost them on every
// PM2 restart). Only an HMAC of the code is stored (see utils/otp.ts).
// MongoDB's TTL monitor deletes a document once expiresAt passes (it runs
// about once a minute, so the controller also checks expiresAt itself).
interface IOtpCode {
  mobile: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  lastSentAt: Date;
}

const otpCodeSchema = new Schema<IOtpCode>(
  {
    mobile: { type: String, required: true, unique: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
  },
  { versionKey: false }
);

export default mongoose.model<IOtpCode>("OtpCode", otpCodeSchema);
