// Runnable self-check for the serial number helpers — no network/DB call,
// matching the codebase's no-framework selftest convention.
// Run: npx ts-node src/utils/serialNumber.selftest.ts (or `npm test`)
import assert from "assert";
import { normalizeSerialNumber, findSerialConflict, SerialOwnerLookup } from "./serialNumber";

function main() {
  // 1. Trims whitespace.
  assert.strictEqual(normalizeSerialNumber("  DL5420ABC123  "), "DL5420ABC123");
  assert.strictEqual(normalizeSerialNumber(""), "");
  assert.strictEqual(normalizeSerialNumber("   "), "");

  // 2. No conflict when the serial doesn't exist anywhere yet.
  assert.strictEqual(findSerialConflict([], "SN-001", "LS-1", "item-1"), null);

  // 3. Conflict: same serial already on a different item in a different order.
  const candidates: SerialOwnerLookup[] = [
    { orderId: "LS-1", items: [{ _id: "item-1", serialNumber: "SN-001" }] },
  ];
  assert.strictEqual(findSerialConflict(candidates, "SN-001", "LS-2", "item-2"), "LS-1");

  // 4. No false conflict: re-saving the exact same item with its own
  // existing value must not flag itself as a duplicate.
  assert.strictEqual(findSerialConflict(candidates, "SN-001", "LS-1", "item-1"), null);

  // 5. Conflict: same serial reused on a different item within the SAME
  // order (two laptops in one order accidentally given the same serial).
  const sameOrderCandidates: SerialOwnerLookup[] = [
    { orderId: "LS-3", items: [{ _id: "item-a", serialNumber: "SN-002" }, { _id: "item-b" }] },
  ];
  assert.strictEqual(findSerialConflict(sameOrderCandidates, "SN-002", "LS-3", "item-b"), "LS-3");

  // 6. Multi-item order: each item can hold its own distinct serial with no
  // conflict between them.
  const multiItem: SerialOwnerLookup[] = [
    { orderId: "LS-4", items: [{ _id: "item-x", serialNumber: "SN-X" }, { _id: "item-y", serialNumber: "SN-Y" }] },
  ];
  assert.strictEqual(findSerialConflict(multiItem, "SN-Y", "LS-4", "item-y"), null);
  assert.strictEqual(findSerialConflict(multiItem, "SN-X", "LS-4", "item-y"), "LS-4");

  console.log("serialNumber.selftest: all assertions passed");
}

main();
