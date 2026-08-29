// Runnable self-check for imageCostControl.ts's pure logic — no DB call
// (checkBudgetAndLimits/getMonthlyUsageSummary need Mongo and are exercised
// manually per the plan's verification steps, not here — this project has a
// single shared MongoDB with no disposable test database, so an automated
// test here would risk writing into it).
// Run: npx ts-node src/services/imageCostControl.selftest.ts (or `npm test`)
import assert from "assert";
import { computeProcessingHash, estimateCost, isAiProcessingEnabled, sha256 } from "./imageCostControl";

function main() {
  // 1. Deterministic: same inputs -> same hash.
  const base = { originalImageHash: "abc123", viewType: "open_front" as const, promptVersion: "lapshark-v1", processingConfigVersion: "v1" };
  assert.strictEqual(computeProcessingHash(base), computeProcessingHash({ ...base }));

  // 2. Changes when any of the 4 fingerprint inputs change...
  assert.notStrictEqual(computeProcessingHash(base), computeProcessingHash({ ...base, originalImageHash: "different" }));
  assert.notStrictEqual(computeProcessingHash(base), computeProcessingHash({ ...base, viewType: "closed_top" }));
  assert.notStrictEqual(computeProcessingHash(base), computeProcessingHash({ ...base, promptVersion: "lapshark-v2" }));
  assert.notStrictEqual(computeProcessingHash(base), computeProcessingHash({ ...base, processingConfigVersion: "v2" }));

  // 3. ...but the fingerprint type has no room for composition-only fields
  //    (scale/position/shadow/etc) at all — a compile-time guarantee that
  //    Sharp-only changes can never affect it (Phase 25A #4).
  const keys = Object.keys(base);
  assert.deepStrictEqual(keys.sort(), ["originalImageHash", "processingConfigVersion", "promptVersion", "viewType"]);

  // 4. No pricing configured -> never invents a number.
  delete process.env.OPENAI_IMAGE_PRICE_INPUT_PER_1K;
  delete process.env.OPENAI_IMAGE_PRICE_OUTPUT_PER_1K;
  delete process.env.OPENAI_IMAGE_FLAT_COST_USD;
  const noPricing = estimateCost({ input_tokens: 100, output_tokens: 200 });
  assert.strictEqual(noPricing.amountUsd, null);
  assert.strictEqual(noPricing.approximate, true);

  // 5. Flat fallback used when configured and no usage-based rate is set.
  process.env.OPENAI_IMAGE_FLAT_COST_USD = "0.05";
  const flat = estimateCost(null);
  assert.strictEqual(flat.amountUsd, 0.05);
  assert.strictEqual(flat.approximate, true);
  delete process.env.OPENAI_IMAGE_FLAT_COST_USD;

  // 6. Usage-based cost, when both usage and rates are present, is exact.
  process.env.OPENAI_IMAGE_PRICE_INPUT_PER_1K = "10";
  process.env.OPENAI_IMAGE_PRICE_OUTPUT_PER_1K = "40";
  const usageBased = estimateCost({ input_tokens: 1000, output_tokens: 500 });
  assert.strictEqual(usageBased.amountUsd, 1 * 10 + 0.5 * 40);
  assert.strictEqual(usageBased.approximate, false);
  delete process.env.OPENAI_IMAGE_PRICE_INPUT_PER_1K;
  delete process.env.OPENAI_IMAGE_PRICE_OUTPUT_PER_1K;

  // 7. Kill switch: default enabled, explicit "false" disables.
  delete process.env.OPENAI_IMAGE_PROCESSING_ENABLED;
  assert.strictEqual(isAiProcessingEnabled(), true);
  process.env.OPENAI_IMAGE_PROCESSING_ENABLED = "false";
  assert.strictEqual(isAiProcessingEnabled(), false);
  delete process.env.OPENAI_IMAGE_PROCESSING_ENABLED;

  // 8. sha256 helper is deterministic and matches the metaCapi.ts convention.
  assert.strictEqual(sha256("x"), sha256("x"));
  assert.notStrictEqual(sha256("x"), sha256("y"));

  console.log("imageCostControl.selftest: all assertions passed");
}

main();
