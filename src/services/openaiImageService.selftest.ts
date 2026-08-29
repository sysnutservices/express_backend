// Runnable self-check for openaiImageService.ts — no test framework, no
// network call (never calls OpenAI), matching imageProcessing.selftest.ts's
// convention.
// Run: npx ts-node src/services/openaiImageService.selftest.ts (or `npm test`)
import assert from "assert";
import {
  VIEW_TYPE_DESCRIPTIONS,
  buildLapsharkImagePrompt,
  classifyOpenAIError,
  computeEditSize,
  IMAGE_PROMPT_VERSION,
} from "./openaiImageService";
import { ProductViewType } from "./imageProcessing";

function main() {
  // 1. Every view type the pipeline supports (incl. the codebase's existing
  //    closed_rear, which the spec's list omits) has a presentation sentence.
  const expectedViews: ProductViewType[] = [
    "open_front", "open_angle", "closed_top", "closed_angle", "closed_rear",
    "bottom", "left_side", "right_side", "ports", "detail", "custom",
  ];
  for (const v of expectedViews) {
    assert.ok(VIEW_TYPE_DESCRIPTIONS[v] && VIEW_TYPE_DESCRIPTIONS[v].length > 0, `missing description for ${v}`);
  }

  // 2. Prompt always contains the fixed core-instructions block plus exactly
  //    the right per-view sentence — never scattered/rebuilt per call site.
  for (const v of expectedViews) {
    const prompt = buildLapsharkImagePrompt({ viewType: v });
    assert.ok(prompt.includes("THE PHYSICAL LAPTOP MUST BE PRESERVED EXACTLY"), `${v}: missing core instructions`);
    assert.ok(prompt.includes(VIEW_TYPE_DESCRIPTIONS[v]), `${v}: missing view-specific sentence`);
  }

  // 2b. lapshark-v2's prompt must never contain vocabulary that could read
  //     as an invitation to improve/beautify a refurbished product — that's
  //     exactly what nudges a generative model into touching up real wear.
  const bannedWords = ["beautiful", "premium", "flawless", "pristine", "enhanced", "polished", "perfect"];
  const anyPrompt = buildLapsharkImagePrompt({ viewType: "open_front" }).toLowerCase();
  for (const word of bannedWords) {
    // Word-boundary match — "imperfections" (which the prompt correctly
    // says NOT to remove) contains the substring "perfect" but isn't it.
    assert.ok(!new RegExp(`\\b${word}\\b`).test(anyPrompt), `prompt must not contain creative/beautifying word "${word}"`);
  }
  // Unknown view type falls back to "custom" rather than throwing.
  const fallback = buildLapsharkImagePrompt({ viewType: "not_a_real_view" as ProductViewType });
  assert.ok(fallback.includes(VIEW_TYPE_DESCRIPTIONS.custom));

  assert.strictEqual(typeof IMAGE_PROMPT_VERSION, "string");
  assert.ok(IMAGE_PROMPT_VERSION.length > 0);

  // 2c. computeEditSize matches the source's own aspect ratio (never forces
  //     a square) so OpenAI edits the photo it was given instead of
  //     composing a new layout inside a shape it wasn't given — dimensions
  //     divisible by 16 (gpt-image-2's requirement) and capped so a huge
  //     source photo doesn't request an oversized, slow/costly edit.
  function parseSize(s: string) {
    const [w, h] = s.split("x").map(Number);
    return { w, h };
  }
  const portrait = parseSize(computeEditSize(3024, 4032)); // real ThinkPad L480 photo dims
  assert.ok(portrait.w % 16 === 0 && portrait.h % 16 === 0, "dimensions must be divisible by 16");
  assert.ok(portrait.h > portrait.w, "portrait source must stay portrait, not be forced square");
  assert.ok(Math.max(portrait.w, portrait.h) <= 1536, "must respect the max-dimension cap");

  const landscape = parseSize(computeEditSize(4032, 3024));
  assert.ok(landscape.w > landscape.h, "landscape source must stay landscape");

  const square = parseSize(computeEditSize(2000, 2000));
  assert.strictEqual(square.w, square.h, "a genuinely square source should stay square");

  const small = parseSize(computeEditSize(600, 400));
  assert.ok(small.w >= 512 && small.h >= 512, "must respect the min-dimension floor");

  // 3. Error classification: transient (retryable) vs permanent.
  assert.strictEqual(classifyOpenAIError({ status: 429 }).transient, true);
  assert.strictEqual(classifyOpenAIError({ status: 503 }).transient, true);
  assert.strictEqual(classifyOpenAIError(new Error("request timeout")).transient, true);
  assert.strictEqual(classifyOpenAIError({ status: 400 }).transient, false);
  assert.strictEqual(classifyOpenAIError({ status: 401 }).transient, false);

  console.log("openaiImageService.selftest: all assertions passed");
}

main();
