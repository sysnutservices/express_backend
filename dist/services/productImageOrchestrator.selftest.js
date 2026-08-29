"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Runnable self-check for productImageOrchestrator.ts's pure logic — no DB
// call, no OpenAI call, matching the codebase's no-framework selftest
// convention.
//
// NOTE — scope: this project has one shared MongoDB (no disposable test
// database — see lapshark_backend/src/config/db.ts, single MONGO_URI), so
// the full stateful invariants (one-OpenAI-call-per-operation, fingerprint
// reuse suppresses a second call, reprocess always uses the original bytes
// not a prior version's output, original URL/hash never mutate) are NOT
// exercised here with a mocked DB — doing so would mean either adding a new
// in-memory-Mongo dependency for one test file, or writing/deleting rows
// against the real shared database from an automated test, both rejected as
// disproportionate/risky for this codebase. Those invariants are structural
// in createEcommerceImage's implementation instead (it always reads
// root.originalImageUrl/originalImageHash, never a version's output; it
// looks up an existing READY_FOR_REVIEW/APPROVED/PUBLISHED version by
// processingHash before calling OpenAI; it never reassigns
// root.originalImageUrl/originalImageHash after creation) and were verified
// manually.
// Run: npx ts-node src/services/productImageOrchestrator.selftest.ts (or `npm test`)
const assert_1 = __importDefault(require("assert"));
const productImageOrchestrator_1 = require("./productImageOrchestrator");
function main() {
    // 1. Retry budget: 1 initial attempt + 2 retries (Phase 25A #21's "maximum
    //    automatic retries: 2").
    assert_1.default.strictEqual(productImageOrchestrator_1.MAX_ATTEMPTS, 3);
    // 2. Every budget/limit rejection maps to the spec's exact user-facing text.
    assert_1.default.strictEqual((0, productImageOrchestrator_1.budgetLimitMessage)("AI_DISABLED"), "AI image processing is temporarily disabled.");
    assert_1.default.strictEqual((0, productImageOrchestrator_1.budgetLimitMessage)("MONTHLY_BUDGET"), "Monthly image processing budget has been reached.");
    assert_1.default.ok((0, productImageOrchestrator_1.budgetLimitMessage)("DAILY_LIMIT").toLowerCase().includes("daily"));
    assert_1.default.ok((0, productImageOrchestrator_1.budgetLimitMessage)("HOURLY_LIMIT").toLowerCase().includes("hourly"));
    // 3. OrchestratorError carries its code through so the controller can map
    //    it to the right HTTP status without string-matching messages.
    const err = new productImageOrchestrator_1.OrchestratorError("NOT_FOUND", "Image not found");
    assert_1.default.strictEqual(err.code, "NOT_FOUND");
    assert_1.default.strictEqual(err.message, "Image not found");
    assert_1.default.ok(err instanceof Error);
    console.log("productImageOrchestrator.selftest: all assertions passed");
}
main();
