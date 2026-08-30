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

  // 2. The master prompt's own non-negotiable guarantees are present.
  assert.ok(MASTER_PROMPT.startsWith("EDIT THE SUPPLIED PHOTOGRAPH. DO NOT RECREATE THE PRODUCT."));
  assert.ok(MASTER_PROMPT.includes("Do not generate a replacement product"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("same physical laptop"));

  // 2b. Geometry/orientation preservation — the exact failure mode a live
  //     test caught (a source photo came back with the laptop rotated
  //     vertical, keyboard and trackpad gone) — and the prompt must NOT
  //     hand OpenAI any composition/framing responsibility, since Sharp
  //     already owns that reliably everywhere else in this pipeline.
  assert.ok(MASTER_PROMPT.toLowerCase().includes("do not rotate the laptop"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("do not remove the keyboard"));
  assert.ok(MASTER_PROMPT.toLowerCase().includes("do not remove the trackpad"));
  assert.ok(!MASTER_PROMPT.toLowerCase().includes("center the product"), "must not ask OpenAI to center/compose — that's Sharp's job");
  assert.ok(!MASTER_PROMPT.toLowerCase().includes("correct minor perspective"), "must not ask OpenAI to correct perspective/alignment — that's Sharp's job");

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
