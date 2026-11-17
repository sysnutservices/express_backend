// Runnable self-check for the OTP helpers. No network/DB call, matching the
// codebase's no-framework selftest convention.
// Run: npx ts-node src/utils/otp.selftest.ts (or `npm test`)
import assert from "assert";
import { generateOtp, hashOtp, otpSecret, resendWaitMs, OTP_RESEND_COOLDOWN_MS } from "./otp";

function main() {
  const secret = "test-secret";

  // 1. Codes are always 6 digits.
  for (let i = 0; i < 2000; i++) assert.match(generateOtp(), /^\d{6}$/);

  // 2. The stored value is a hash, never the code itself.
  const h = hashOtp("9876543210", "123456", secret);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("123456"));

  // 3. Same inputs give the same hash (so the DB lookup can match it).
  assert.strictEqual(hashOtp("9876543210", "123456", secret), h);

  // 4. A different code, number or secret gives a different hash: a hash
  // can't be reused for another number, and is useless without the secret.
  assert.notStrictEqual(hashOtp("9876543210", "123457", secret), h);
  assert.notStrictEqual(hashOtp("9876543211", "123456", secret), h);
  assert.notStrictEqual(hashOtp("9876543210", "123456", "other-secret"), h);

  // 5. Secret: dedicated OTP secret wins, JWT secret is the fallback, and
  // neither set is an error rather than an unkeyed hash.
  assert.strictEqual(otpSecret({ OTP_HASH_SECRET: "a", JWT_SECRET: "b" } as any), "a");
  assert.strictEqual(otpSecret({ JWT_SECRET: "b" } as any), "b");
  assert.throws(() => otpSecret({} as any));

  // 6. Resend cooldown.
  const now = new Date("2026-11-17T10:00:00Z");
  assert.strictEqual(resendWaitMs(null, now), 0);
  assert.strictEqual(resendWaitMs(undefined, now), 0);
  assert.strictEqual(resendWaitMs(new Date(now.getTime() - 10_000), now), OTP_RESEND_COOLDOWN_MS - 10_000);
  assert.strictEqual(resendWaitMs(new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS), now), 0);
  assert.strictEqual(resendWaitMs(new Date(now.getTime() - 3_600_000), now), 0);

  console.log("otp selftest: all checks passed");
}

main();
