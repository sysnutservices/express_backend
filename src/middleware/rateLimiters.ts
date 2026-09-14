import rateLimit from "express-rate-limit";

// Broad abuse/DoS backstop across the whole API — mounted once on /api.
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Admin email/password login — the endpoint this pass exists to protect.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts, please try again later." },
});

// Sending an OTP costs a real WhatsApp/SMS send — cap requests, not just
// verify attempts, or this becomes a free way to spam any phone number.
export const otpSendLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP requests, please try again later." },
});

// Verifying a 6-digit OTP — 10/15min per IP is enough headroom for a
// legit user who fat-fingers it twice, while making brute-forcing all
// 1,000,000 combinations inside the 5-minute OTP window infeasible.
export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please request a new OTP." },
});
