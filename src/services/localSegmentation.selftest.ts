// Runnable self-check for localSegmentation.ts's pure helper logic — no
// model inference (never downloads/loads the 178MB ONNX model, no network),
// matching the codebase's no-framework, no-network selftest convention.
//
// localSegmentation.ts is currently unused by productImageOrchestrator.ts
// (OpenAI GPT Image 2 is the sole pipeline again, by explicit decision — see
// the note at the top of productImageOrchestrator.ts) but kept in place,
// not deleted, in case that decision changes again. Its segmentation
// quality (does it hallucinate product pixels? does it handle a cluttered
// studio backdrop cleanly?) was verified manually against a real LapShark
// product photo when it was adopted — see the connected-component-labeling
// and morphological-closing comments in localSegmentation.ts for what that
// testing found and fixed. Re-running that full benchmark isn't automated
// here for the same reason imageProcessing.selftest.ts doesn't call the
// real PhotoRoom API: it needs a real photo and, here, a 178MB model
// download.
// Run: npx ts-node src/services/localSegmentation.selftest.ts (or `npm test`)
import assert from "assert";
import { computeBBoxFromMask, largestComponentMask, boxMorph } from "./localSegmentation";

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

  console.log("localSegmentation.selftest: all assertions passed");
}

main();
