// Runnable self-check for the WhatsApp order items line — no network/DB.
// Run: npx ts-node src/utils/orderItemsSummary.selftest.ts (or `npm test`)
import assert from "assert";
import { orderItemsSummary, MAX_ITEMS_PARAM_LENGTH } from "./orderItemsSummary";

function main() {
  // Chosen upgrade is in specs (createOrder writes it there).
  assert.strictEqual(
    orderItemsSummary([{ title: "Dell Latitude 5490", quantity: 1, specs: { ram: "16GB", storage: "512GB" } }]),
    "Dell Latitude 5490 (16GB RAM, 512GB SSD) x1",
  );
  // Older order: no specs, only selectedConfig; "Gb" normalised.
  assert.strictEqual(
    orderItemsSummary([{ title: "HP 840 G5", quantity: 2, selectedConfig: { ram: "8Gb", storage: "256Gb" } }]),
    "HP 840 G5 (8GB RAM, 256GB SSD) x2",
  );
  // Nothing known: just the title. Already-labelled values aren't doubled.
  assert.strictEqual(orderItemsSummary([{ title: "ThinkPad T490", quantity: 1 }]), "ThinkPad T490 x1");
  assert.strictEqual(
    orderItemsSummary([{ title: "X", quantity: 1, specs: { ram: "16GB RAM", storage: "1TB SSD" } }]),
    "X (16GB RAM, 1TB SSD) x1",
  );
  // Multiple items, newlines flattened, length capped.
  const two = orderItemsSummary([
    { title: "A\nB", quantity: 1, specs: { ram: "8GB" } },
    { title: "C", quantity: 1 },
  ]);
  assert.strictEqual(two, "A B (8GB RAM) x1; C x1");
  const long = orderItemsSummary(Array.from({ length: 50 }, () => ({ title: "Dell Latitude 7490 Business Laptop", quantity: 1, specs: { ram: "16GB", storage: "512GB" } })));
  assert.ok(long.length <= MAX_ITEMS_PARAM_LENGTH && long.endsWith("…"));
  console.log("orderItemsSummary selftest: all passed");
}

main();
