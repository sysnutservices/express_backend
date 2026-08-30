// Runnable self-check for productImageEditor.ts's pure math — no network
// call (editProductImage itself calls OpenAI and isn't exercised here),
// matching the codebase's selftest convention.
// Run: npx ts-node src/services/productImage/productImageEditor.selftest.ts (or `npm test`)
import assert from "assert";
import sharp from "sharp";
import { computeEditSize, orientationOf, verifyMaskRespected } from "./productImageEditor";

function parseSize(s: string) {
  const [w, h] = s.split("x").map(Number);
  return { w, h };
}

// width x height RGB PNG, left half one solid color, right half another —
// built as one raw buffer (no compositing) so there's no ambiguity about
// how sharp's create/composite handles alpha.
async function splitPng(
  width: number,
  height: number,
  left: [number, number, number],
  right: [number, number, number]
): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const [r, g, b] = x < width / 2 ? left : right;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function main() {
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

  // verifyMaskRespected: the actual mask-compliance safety net — a laptop
  // (blue, left half) with white background (right half). Left half is the
  // preserved region; right half is what OpenAI was free to regenerate.
  const W = 4, H = 4;
  const alpha = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) alpha[y * W + x] = x < W / 2 ? 255 : 0;

  const preserved: [number, number, number] = [20, 40, 200];
  const source = await splitPng(W, H, preserved, [255, 255, 255]);

  // A compliant result: preserved (left) half untouched, edited (right)
  // half repainted to something else entirely.
  const compliantResult = await splitPng(W, H, preserved, [10, 200, 10]);
  assert.strictEqual(
    await verifyMaskRespected(source, alpha, W, H, compliantResult, W, H),
    true,
    "changing only the editable region must pass"
  );

  // A violation: the preserved (left) half itself got repainted.
  const violatingResult = await splitPng(W, H, [10, 200, 10], [10, 200, 10]);
  assert.strictEqual(
    await verifyMaskRespected(source, alpha, W, H, violatingResult, W, H),
    false,
    "changing the preserved region must fail"
  );

  console.log("productImageEditor.selftest: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
