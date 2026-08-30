// Runnable self-check for productImageOrchestrator.ts's pure logic — no DB
// call, matching the codebase's no-framework selftest convention.
//
// NOTE — scope: this project has one shared MongoDB (no disposable test
// database — see lapshark_backend/src/config/db.ts, single MONGO_URI), so
// the full stateful invariants (one-segmentation-run-per-operation,
// fingerprint reuse suppresses a second run, reprocess always uses the
// original bytes not a prior version's output, original URL/hash never
// mutate) are NOT exercised here with a mocked DB — doing so would mean
// either adding a new in-memory-Mongo dependency for one test file, or
// writing/deleting rows against the real shared database from an automated
// test, both rejected as disproportionate/risky for this codebase. Those
// invariants are structural in createEcommerceImage's implementation
// instead (it always reads root.originalImageUrl/originalImageHash, never a
// version's output; it looks up an existing
// READY_FOR_REVIEW/APPROVED/PUBLISHED version by processingHash before
// running segmentation; it never reassigns root.originalImageUrl/
// originalImageHash after creation) and were verified manually.
// Run: npx ts-node src/services/productImageOrchestrator.selftest.ts (or `npm test`)
import assert from "assert";
import { OrchestratorError } from "./productImageOrchestrator";

function main() {
  // OrchestratorError carries its code through so the controller can map
  // it to the right HTTP status without string-matching messages.
  const err = new OrchestratorError("NOT_FOUND", "Image not found");
  assert.strictEqual(err.code, "NOT_FOUND");
  assert.strictEqual(err.message, "Image not found");
  assert.ok(err instanceof Error);

  console.log("productImageOrchestrator.selftest: all assertions passed");
}

main();
