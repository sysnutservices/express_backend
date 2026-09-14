// Runnable self-check for the cancellation-request helpers — no network/DB
// call, matching the codebase's no-framework selftest convention.
// Run: npx ts-node src/utils/cancellation.selftest.ts (or `npm test`)
import assert from "assert";
import { isCustomerCancellable, isValidCancellationReason, CUSTOMER_CANCELLABLE_STATUSES } from "./cancellation";

function main() {
  // 1. Every status this app actually allows a customer to request from.
  for (const status of CUSTOMER_CANCELLABLE_STATUSES) {
    assert.strictEqual(isCustomerCancellable(status, undefined), true, `${status} should be cancellable`);
  }

  // 2. Anything past that point is not.
  for (const status of ["Shipped", "Out for Delivery", "Delivered", "Cancelled", "RTO"]) {
    assert.strictEqual(isCustomerCancellable(status, undefined), false, `${status} should not be cancellable`);
  }

  // 3. A second request is blocked while one is already pending.
  assert.strictEqual(isCustomerCancellable("Processing", "Requested"), false);

  // 4. A rejected request can be re-submitted.
  assert.strictEqual(isCustomerCancellable("Processing", "Rejected"), true);

  // 5. Reason validation: only the fixed enum codes are accepted.
  assert.strictEqual(isValidCancellationReason("changed_mind"), true);
  assert.strictEqual(isValidCancellationReason("other"), true);
  assert.strictEqual(isValidCancellationReason("made_up_reason"), false);
  assert.strictEqual(isValidCancellationReason(""), false);
  assert.strictEqual(isValidCancellationReason(undefined), false);
  assert.strictEqual(isValidCancellationReason(123), false);

  console.log("cancellation.selftest: all assertions passed");
}

main();
