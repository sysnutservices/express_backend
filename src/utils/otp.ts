import crypto from "crypto";

// Pure helpers for the customer login OTP (authController.sendOTP /
// customerLogin). Kept DB-free so they can be unit-tested like pricing.ts;
// the OtpCode model holds the per-mobile state.
//
// OTPs are never stored in plain text. What's stored is an HMAC-SHA256 of
// "<mobile>:<otp>" keyed with a server secret: a 6-digit code has only a
// million values, so a plain unkeyed hash would be reversible by brute force
// if the database leaked; the key isn't in the database. Including the mobile
// means a stored hash can't be reused for another number.

export const OTP_TTL_MS = 5 * 60 * 1000; // unchanged from the old in-memory store
export const OTP_MAX_ATTEMPTS = 5; // wrong guesses per code, across all IPs
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000; // the login form itself waits 60s

export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function otpSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.OTP_HASH_SECRET || env.JWT_SECRET;
  if (!secret) throw new Error("OTP_HASH_SECRET or JWT_SECRET must be set to hash OTPs");
  return secret;
}

export function hashOtp(mobile: string, otp: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`otp:v1:${mobile}:${otp}`).digest("hex");
}

// Milliseconds the caller must still wait before another OTP may be sent to
// the same number (0 = may send now).
export function resendWaitMs(lastSentAt: Date | null | undefined, now: Date = new Date()): number {
  if (!lastSentAt) return 0;
  return Math.max(0, lastSentAt.getTime() + OTP_RESEND_COOLDOWN_MS - now.getTime());
}
