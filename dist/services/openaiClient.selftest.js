"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Runnable self-check for openaiClient.ts — no test framework, no network
// call (never calls OpenAI), matching the codebase's selftest convention.
// Run: npx ts-node src/services/openaiClient.selftest.ts (or `npm test`)
const assert_1 = __importDefault(require("assert"));
const openaiClient_1 = require("./openaiClient");
function main() {
    // Error classification: transient (retryable) vs permanent.
    assert_1.default.strictEqual((0, openaiClient_1.classifyOpenAIError)({ status: 429 }).transient, true);
    assert_1.default.strictEqual((0, openaiClient_1.classifyOpenAIError)({ status: 503 }).transient, true);
    assert_1.default.strictEqual((0, openaiClient_1.classifyOpenAIError)(new Error("request timeout")).transient, true);
    assert_1.default.strictEqual((0, openaiClient_1.classifyOpenAIError)({ status: 400 }).transient, false);
    assert_1.default.strictEqual((0, openaiClient_1.classifyOpenAIError)({ status: 401 }).transient, false);
    console.log("openaiClient.selftest: all assertions passed");
}
main();
