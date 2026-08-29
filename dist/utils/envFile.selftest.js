"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Runnable self-check for envFile.ts's pure logic (mask/validate) — the
// actual file write is exercised manually, not here, since it mutates the
// real .env file this process loaded its config from.
// Run: npx ts-node src/utils/envFile.selftest.ts (or `npm test`)
const assert_1 = __importDefault(require("assert"));
const envFile_1 = require("./envFile");
function main() {
    // 1. Rejects newlines/control chars (env-injection guard) and blank values.
    assert_1.default.strictEqual((0, envFile_1.isSafeEnvValue)("sk-abc123"), true);
    assert_1.default.strictEqual((0, envFile_1.isSafeEnvValue)("sk-abc\ninjected=true"), false);
    assert_1.default.strictEqual((0, envFile_1.isSafeEnvValue)("sk-abc\rinjected=true"), false);
    assert_1.default.strictEqual((0, envFile_1.isSafeEnvValue)(""), false);
    assert_1.default.strictEqual((0, envFile_1.isSafeEnvValue)("   "), false);
    // 2. Masking never reveals more than the last 4 characters.
    const masked = (0, envFile_1.maskSecret)("sk-proj-abcdefgh1234");
    assert_1.default.ok(masked.endsWith("1234"));
    assert_1.default.ok(!masked.includes("abcdefgh"));
    assert_1.default.strictEqual((0, envFile_1.maskSecret)("ab").length, 2);
    console.log("envFile.selftest: all assertions passed");
}
main();
