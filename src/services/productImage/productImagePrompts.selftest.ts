// Runnable self-check for productImagePrompts.ts — no network call, matching
// the codebase's selftest convention.
// Run: npx ts-node src/services/productImage/productImagePrompts.selftest.ts (or `npm test`)
import assert from "assert";
import { buildProductImagePrompt, MASTER_PROMPT, PRODUCT_IMAGE_PROMPT_VERSION } from "./productImagePrompts";
import { ProductImageType } from "./productImageTypes";

function main() {
  const ALL_TYPES: ProductImageType[] = [
    "OPEN_LAPTOP_SCREEN_ON",
    "OPEN_LAPTOP_SCREEN_OFF",
    "CLOSED_LAPTOP_FRONT",
    "CLOSED_LAPTOP_BACK",
    "SIDE_VIEW",
    "KEYBOARD_CLOSEUP",
    "SCREEN_CLOSEUP",
    "OTHER_PRODUCT_VIEW",
  ];

  // 1. Every image type produces a prompt built on the master preservation
  //    rules plus its own distinct addition — never the bare master alone,
  //    never two types sharing identical text.
  const built = ALL_TYPES.map((t) => buildProductImagePrompt(t));
  for (const prompt of built) {
    assert.ok(prompt.includes(MASTER_PROMPT), "every prompt must include the master preservation rules verbatim");
    assert.ok(prompt.length > MASTER_PROMPT.length, "every prompt must add a type-specific addition on top of the master");
  }
  assert.strictEqual(new Set(built).size, built.length, "every image type must produce a distinct prompt");

  // 2. The master prompt's own non-negotiable identity guarantees are
  //    present — product identity is carried by this prompt alone now (see
  //    the v2.0 comment in productImagePrompts.ts for why there's no runtime
  //    enforcement of it anymore).
  assert.ok(MASTER_PROMPT.startsWith("EDIT THE SUPPLIED LAPTOP PHOTOGRAPH INTO A PROFESSIONAL E-COMMERCE PRODUCT PHOTOGRAPH."));
  assert.ok(MASTER_PROMPT.includes("Do not replace the laptop with another laptop."));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("preserve the exact physical identity"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("same laptop supplied in the source image"));
  assert.ok(MASTER_PROMPT.includes("PRODUCT IDENTITY HAS PRIORITY OVER BEAUTIFICATION."));

  // 2b. Composition is explicitly GPT's job now (v2.0 — the opposite of the
  //     v1.x architecture, where a forced square canvas + composition-owning
  //     prompt together caused a live rotated-result failure; that failure
  //     mode doesn't apply anymore because the OUTPUT canvas is what OpenAI
  //     is asked for directly, not a mismatched fixed size layered under a
  //     prompt fighting it).
  assert.ok(MASTER_PROMPT.includes("1024 x 1024"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("center the laptop"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("keep the entire laptop inside the frame"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("do not rotate the laptop"));

  // 3. Screen-state prompts actually say something different about the
  //    screen, and don't cross-contradict each other.
  const onPrompt = buildProductImagePrompt("OPEN_LAPTOP_SCREEN_ON").toLowerCase();
  const offPrompt = buildProductImagePrompt("OPEN_LAPTOP_SCREEN_OFF").toLowerCase();
  assert.ok(onPrompt.includes("screen is on"));
  assert.ok(offPrompt.includes("screen is off"));
  assert.ok(!onPrompt.includes("do not turn it on"), "the screen-ON prompt must not contain the screen-OFF instruction");
  assert.ok(!offPrompt.includes("preserve the fact that it is genuinely displaying content"), "the screen-OFF prompt must not contain the screen-ON instruction");

  // 4. Closed-laptop prompts explicitly forbid opening the laptop.
  assert.ok(buildProductImagePrompt("CLOSED_LAPTOP_FRONT").toLowerCase().includes("keep it closed"));
  assert.ok(buildProductImagePrompt("CLOSED_LAPTOP_BACK").toLowerCase().includes("keep it closed"));

  assert.strictEqual(typeof PRODUCT_IMAGE_PROMPT_VERSION, "string");
  assert.ok(PRODUCT_IMAGE_PROMPT_VERSION.length > 0);

  console.log("productImagePrompts.selftest: all assertions passed");
}

main();
