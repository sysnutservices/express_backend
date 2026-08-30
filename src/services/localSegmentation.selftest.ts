// Runnable self-check for localSegmentation.ts's pure helper logic — no
// model inference (never downloads/loads the 178MB ONNX model, no network),
// matching the codebase's no-framework, no-network selftest convention.
//
// This is the sole default background-removal path (productImageOrchestrator.
// createEcommerceImage and the legacy productController.processImage both run
// it directly on the original photo — see the note at the top of
// productImageOrchestrator.ts). Its segmentation quality (does it hallucinate
// product pixels? does it handle a cluttered studio backdrop cleanly?) was
// verified manually against a real LapShark product photo when it was
// adopted — see the connected-component-labeling and morphological-closing
// comments in localSegmentation.ts for what that testing found and fixed.
// Re-running that full benchmark isn't automated here for the same reason
// imageProcessing.selftest.ts doesn't call the real PhotoRoom API: it needs
// a real photo and, here, a 178MB model download.
// Run: npx ts-node src/services/localSegmentation.selftest.ts (or `npm test`)
import assert from "assert";
import { computeBBoxFromMask, largestComponentMask, boxMorph, computeAlphaStats, fillEnclosedHoles } from "./localSegmentation";

function main() {
  const W = 10,
    H = 10;

  // 1. computeBBoxFromMask finds the exact tight bounding box.
  const mask = new Uint8Array(W * H);
  mask[2 * W + 3] = 255; // (3,2)
  mask[5 * W + 7] = 255; // (7,5)
  const bbox = computeBBoxFromMask(mask, W, H, 127);
  assert.deepStrictEqual(bbox, { left: 3, top: 2, width: 5, height: 4 });

  // 2. No pixel above threshold -> null, not a crash or a bogus 0-sized box.
  assert.strictEqual(computeBBoxFromMask(new Uint8Array(W * H), W, H, 127), null);

  // 3. largestComponentMask keeps only the biggest connected blob — this is
  //    the exact mechanism that discards a studio backdrop's text/graphics
  //    (a small disconnected blob) regardless of the confidence value the
  //    model assigned it.
  const binary = new Uint8Array(W * H);
  // Big blob: a 3x3 square.
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) binary[y * W + x] = 1;
  // Small, disconnected blob elsewhere (simulates background clutter).
  binary[8 * W + 8] = 1;
  const keep = largestComponentMask(binary, W, H);
  assert.strictEqual(keep[0 * W + 0], 1, "big blob pixel should be kept");
  assert.strictEqual(keep[2 * W + 2], 1, "big blob pixel should be kept");
  assert.strictEqual(keep[8 * W + 8], 0, "disconnected small blob must be discarded");
  assert.strictEqual(keep.reduce((a, b) => a + b, 0), 9, "only the 3x3 blob's 9 pixels survive");

  // 4. boxMorph: dilate then erode (closing) fills a single-pixel notch
  //    without materially growing the overall shape.
  const shape = new Uint8Array(W * H);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) shape[y * W + x] = 255;
  shape[2 * W + 5] = 0; // a 1px notch bitten out of the top edge
  const dilated = boxMorph(shape, W, H, 1, true);
  const closed = boxMorph(dilated, W, H, 1, false);
  assert.strictEqual(closed[2 * W + 5], 255, "closing should fill the small notch");
  // Far-away background pixels must still be background after closing.
  assert.strictEqual(closed[0 * W + 0], 0);

  // 5. computeAlphaStats: a real (mixed) mask reports both bounds and a
  //    plausible transparent share; a degenerate all-255 mask — the
  //    BACKGROUND_REMOVAL_FAILED case, segmentation found no background at
  //    all — reports alphaMin === alphaMax so removeBackgroundLocal can
  //    detect it and refuse to proceed.
  const mixedMask = new Uint8Array(100);
  mixedMask.fill(255, 0, 60); // 60% foreground
  const mixedStats = computeAlphaStats(mixedMask);
  assert.strictEqual(mixedStats.alphaMin, 0);
  assert.strictEqual(mixedStats.alphaMax, 255);
  assert.strictEqual(mixedStats.transparentPercent, 40);

  const allForeground = new Uint8Array(100).fill(255);
  const failedStats = computeAlphaStats(allForeground);
  assert.strictEqual(failedStats.alphaMin, failedStats.alphaMax, "a uniform mask must be detectable as a failed segmentation");

  // 6. fillEnclosedHoles: a hole fully enclosed by the foreground (like a
  //    laptop screen's own dark wallpaper content the model didn't
  //    recognize) gets filled in; open background touching the image border
  //    never does, even if it pokes deep into the shape's bounding box.
  const ring = new Uint8Array(W * H);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) ring[y * W + x] = 1; // solid 8x8 block
  ring[5 * W + 5] = 0; // one enclosed hole in the middle
  const filledRing = fillEnclosedHoles(ring, W, H);
  assert.strictEqual(filledRing[5 * W + 5], 1, "enclosed hole must be filled");
  assert.strictEqual(filledRing[0 * W + 0], 0, "true background touching the border must stay background");

  const notch = new Uint8Array(W * H);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) notch[y * W + x] = 1;
  for (let y = 1; y < 9; y++) notch[y * W + 1] = 0; // a notch open to the border via row 0 is NOT enclosed...
  // ...only if it actually connects to the border; make it explicitly reach y=0:
  notch[0 * W + 1] = 0;
  const filledNotch = fillEnclosedHoles(notch, W, H);
  assert.strictEqual(filledNotch[5 * W + 1], 0, "a notch open to the border must not be filled");

  console.log("localSegmentation.selftest: all assertions passed");
}

main();
