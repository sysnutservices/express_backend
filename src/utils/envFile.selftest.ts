// Runnable self-check for envFile.ts's pure logic (mask/validate) — the
// actual file write is exercised manually, not here, since it mutates the
// real .env file this process loaded its config from.
// Run: npx ts-node src/utils/envFile.selftest.ts (or `npm test`)
import assert from "assert";
import { isSafeEnvValue, maskSecret } from "./envFile";

function main() {
  // 1. Rejects newlines/control chars (env-injection guard) and blank values.
  assert.strictEqual(isSafeEnvValue("sk-abc123"), true);
  assert.strictEqual(isSafeEnvValue("sk-abc\ninjected=true"), false);
  assert.strictEqual(isSafeEnvValue("sk-abc\rinjected=true"), false);
  assert.strictEqual(isSafeEnvValue(""), false);
  assert.strictEqual(isSafeEnvValue("   "), false);

  // 2. Masking never reveals more than the last 4 characters.
  const masked = maskSecret("sk-proj-abcdefgh1234");
  assert.ok(masked.endsWith("1234"));
  assert.ok(!masked.includes("abcdefgh"));
  assert.strictEqual(maskSecret("ab").length, 2);

  console.log("envFile.selftest: all assertions passed");
}

main();
