// Runnable self-check for openaiClient.ts — no test framework, no network
// call (never calls OpenAI), matching the codebase's selftest convention.
// Run: npx ts-node src/services/openaiClient.selftest.ts (or `npm test`)
import assert from "assert";
import { classifyOpenAIError } from "./openaiClient";

function main() {
  // Error classification: transient (retryable) vs permanent.
  assert.strictEqual(classifyOpenAIError({ status: 429 }).transient, true);
  assert.strictEqual(classifyOpenAIError({ status: 503 }).transient, true);
  assert.strictEqual(classifyOpenAIError(new Error("request timeout")).transient, true);
  assert.strictEqual(classifyOpenAIError({ status: 400 }).transient, false);
  assert.strictEqual(classifyOpenAIError({ status: 401 }).transient, false);

  console.log("openaiClient.selftest: all assertions passed");
}

main();
