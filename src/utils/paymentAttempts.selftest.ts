// Runnable self-check for the abandoned-checkout reason — no network/DB call.
// Run: npx ts-node src/utils/paymentAttempts.selftest.ts (or `npm test`)
import assert from "assert";
import { summarizePaymentAttempts, methodLabel, RazorpayPaymentLike } from "./paymentAttempts";

const now = new Date(Date.UTC(2026, 10, 19, 12, 0, 0));
const t = (min: number) => Math.floor(now.getTime() / 1000) - min * 60;
const failed = (id: string, minAgo: number, extra: Partial<RazorpayPaymentLike>): RazorpayPaymentLike =>
  ({ id, status: "failed", method: "upi", created_at: t(minAgo), ...extra });

function main() {
  // 1. No attempt at all: closed checkout before picking a method.
  const none = summarizePaymentAttempts([], now);
  assert.strictEqual(none.reason, "Never tried to pay");
  assert.strictEqual(none.count, 0);

  // 2. Cancelled in the UPI app: label, Razorpay's sentence, who failed it.
  const cancelled = summarizePaymentAttempts([
    failed("pay_1", 10, {
      error_code: "BAD_REQUEST_ERROR",
      error_description: "Payment was cancelled by the user",
      error_source: "customer",
      error_reason: "payment_cancelled",
    }),
  ], now);
  assert.strictEqual(cancelled.reason, "Cancelled by customer");
  assert.strictEqual(cancelled.detail, "Payment was cancelled by the user");
  assert.strictEqual(cancelled.errorSource, "customer");
  assert.strictEqual(cancelled.lastMethod, "UPI");
  assert.strictEqual(cancelled.lastStatus, "failed");

  // 3. Several attempts: the latest one decides, whatever the list order.
  const several = summarizePaymentAttempts([
    failed("pay_old", 30, { error_reason: "payment_cancelled", error_source: "customer" }),
    failed("pay_new", 5, { method: "card", error_reason: "insufficient_funds", error_source: "bank" }),
  ], now);
  assert.strictEqual(several.reason, "Insufficient funds");
  assert.strictEqual(several.count, 2);
  assert.strictEqual(several.lastMethod, "Card");

  // 4. Timeouts and bank declines are named; unknown codes fall back on the source.
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, { error_reason: "payment_timed_out" })], now).reason, "Timed out");
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, { error_reason: "card_declined" })], now).reason, "Declined by bank");
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, { error_reason: "invalid_vpa" })], now).reason, "Invalid UPI ID");
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, { error_reason: "incorrect_otp" })], now).reason, "Authentication failed");
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, { error_reason: "something_new", error_source: "customer" })], now).reason, "Failed at customer's end");
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, { error_reason: "something_new", error_source: "bank" })], now).reason, "Failed at bank");
  assert.strictEqual(summarizePaymentAttempts([failed("p", 1, {})], now).reason, "Payment failed");

  // 5. A captured or authorized payment beats any later failure: the order isn't really abandoned.
  const paid = summarizePaymentAttempts([
    failed("pay_f", 1, { error_reason: "payment_cancelled" }),
    { id: "pay_c", status: "captured", method: "upi", created_at: t(20) },
  ], now);
  assert.strictEqual(paid.reason, "Paid on Razorpay, not recorded");
  assert.strictEqual(paid.detail, undefined);
  assert.strictEqual(
    summarizePaymentAttempts([{ id: "pay_a", status: "authorized", method: "card", created_at: t(2) }], now).reason,
    "Authorized, not captured",
  );

  // 6. Still in progress (status created).
  assert.strictEqual(
    summarizePaymentAttempts([{ id: "pay_x", status: "created", method: "upi", created_at: t(2) }], now).reason,
    "Payment started, not completed",
  );

  // 7. Method labels name the bank/wallet.
  assert.strictEqual(methodLabel({ method: "netbanking", bank: "HDFC" }), "Netbanking (HDFC)");
  assert.strictEqual(methodLabel({ method: "wallet", wallet: "paytm" }), "Wallet (paytm)");
  assert.strictEqual(methodLabel({}), undefined);

  console.log("paymentAttempts selftest: all checks passed");
}

main();
