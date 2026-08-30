// Runnable self-check for productImageEditor.ts's pure math — no network
// call (editProductImage itself calls OpenAI and isn't exercised here),
// matching the codebase's selftest convention.
// Run: npx ts-node src/services/productImage/productImageEditor.selftest.ts (or `npm test`)
import assert from "assert";
import { computeEditSize, orientationOf } from "./productImageEditor";

function parseSize(s: string) {
  const [w, h] = s.split("x").map(Number);
  return { w, h };
}

function main() {
  // computeEditSize matches the source's own aspect ratio (never forces a
  // square) so OpenAI edits the photo it was given instead of being asked
  // to fit content into a shape it wasn't given — this is the exact fix for
  // a live failure where a forced "1024x1024" square combined with a
  // composition-owning prompt produced a rotated, geometry-broken result.
  const portrait = parseSize(computeEditSize(3024, 4032));
  assert.ok(portrait.w % 16 === 0 && portrait.h % 16 === 0, "dimensions must be divisible by 16");
  assert.ok(portrait.h > portrait.w, "portrait source must stay portrait, not be forced square");
  assert.ok(Math.max(portrait.w, portrait.h) <= 1536, "must respect the max-dimension cap");

  const landscape = parseSize(computeEditSize(4032, 3024));
  assert.ok(landscape.w > landscape.h, "landscape source must stay landscape");

  const square = parseSize(computeEditSize(2000, 2000));
  assert.strictEqual(square.w, square.h, "a genuinely square source should stay square");

  const small = parseSize(computeEditSize(600, 400));
  assert.ok(small.w >= 512 && small.h >= 512, "must respect the min-dimension floor");

  const extreme = parseSize(computeEditSize(4000, 800)); // 5:1 source
  assert.ok(extreme.w / extreme.h <= 3, "must clamp to gpt-image-2's 1:3..3:1 aspect ratio limit");

  // orientationOf: the actual geometry-mismatch safety net's classification
  // — this is what catches "the laptop got rotated" without needing a
  // pixel-perfect comparison, just a category match.
  assert.strictEqual(orientationOf(4032, 3024), "landscape");
  assert.strictEqual(orientationOf(3024, 4032), "portrait");
  assert.strictEqual(orientationOf(2000, 2000), "square");
  assert.notStrictEqual(orientationOf(4032, 3024), orientationOf(3024, 4032), "a rotated result must classify differently from its source");

  console.log("productImageEditor.selftest: all assertions passed");
}

main();
