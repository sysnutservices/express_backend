// Runnable self-check for the payment reminder selection — no network/DB
// call, matching the codebase's no-framework selftest convention.
// Run: npx ts-node src/utils/paymentReminder.selftest.ts (or `npm test`)
import assert from "assert";
import { pickOrdersToRemind, customerKeyOf, amountDue, ReminderCandidate } from "./paymentReminder";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 15, 12, 0, 0);
const ago = (h: number) => new Date(now - h * HOUR);
const order = (orderId: string, customerKey: string, hoursAgo: number, reminded = false): ReminderCandidate =>
  ({ orderId, customerKey, createdAt: ago(hoursAgo), reminded });

function main() {
  // 1. A plain abandoned order inside the window is reminded.
  assert.deepStrictEqual(pickOrdersToRemind([order("A", "user:1", 2)], [], now), ["A"]);

  // 2. Too fresh (under 1h) or too old (over 24h): not reminded.
  assert.deepStrictEqual(pickOrdersToRemind([order("A", "user:1", 0.5)], [], now), []);
  assert.deepStrictEqual(pickOrdersToRemind([order("A", "user:1", 30)], [], now), []);

  // 3. Several abandoned orders from one customer: only the latest one.
  assert.deepStrictEqual(
    pickOrdersToRemind([order("A", "user:1", 5), order("B", "user:1", 3), order("C", "user:1", 4)], [], now),
    ["B"],
  );

  // 4. Latest one still fresh: the customer may still be checking out, so
  // the older one is not reminded either.
  assert.deepStrictEqual(pickOrdersToRemind([order("A", "user:1", 5), order("B", "user:1", 0.2)], [], now), []);

  // 5. Latest one already reminded: nothing more, even for older orders.
  assert.deepStrictEqual(pickOrdersToRemind([order("A", "user:1", 5), order("B", "user:1", 3, true)], [], now), []);

  // 6. Paid for something after the abandoned order: skip.
  assert.deepStrictEqual(
    pickOrdersToRemind([order("A", "user:1", 5)], [{ customerKey: "user:1", createdAt: ago(4) }], now),
    [],
  );
  // ...but a paid order from before it, or another customer's, doesn't count.
  assert.deepStrictEqual(
    pickOrdersToRemind(
      [order("A", "user:1", 5)],
      [{ customerKey: "user:1", createdAt: ago(10) }, { customerKey: "user:2", createdAt: ago(1) }],
      now,
    ),
    ["A"],
  );

  // 7. Different customers are independent; an order with no customer key
  // (no account, no phone) is never reminded.
  assert.deepStrictEqual(
    pickOrdersToRemind([order("A", "user:1", 2), order("B", "phone:9876543210", 3), order("C", "", 2)], [], now).sort(),
    ["A", "B"],
  );

  // 8. customerKeyOf: account first, populated or not; phone digits otherwise.
  assert.strictEqual(customerKeyOf({ userId: "abc" }), "user:abc");
  assert.strictEqual(customerKeyOf({ userId: { _id: "abc", mobile: "1" } }), "user:abc");
  assert.strictEqual(customerKeyOf({ shippingAddress: { phone: "+91 98765 43210" } }), "phone:9876543210");
  assert.strictEqual(customerKeyOf({ shippingAddress: { phone: "" } }), "");

  // 9. amountDue: the advance for COD, the total for prepaid.
  assert.strictEqual(amountDue({ paymentMethod: "COD", advanceAmount: 500, total: 25000 }), 500);
  assert.strictEqual(amountDue({ paymentMethod: "Online", advanceAmount: 0, total: 25000 }), 25000);

  console.log("paymentReminder: all checks passed");
}

main();
