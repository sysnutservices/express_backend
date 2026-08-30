// Runnable self-check for productImageTypes.ts — no network, no model
// inference, matching the codebase's selftest convention.
// Run: npx ts-node src/services/productImage/productImageTypes.selftest.ts (or `npm test`)
import assert from "assert";
import sharp from "sharp";
import { detectImageType } from "./productImageTypes";

async function main() {
  // 1. Non-open view types map straight to their category regardless of
  //    what's in the photo — no screen heuristic needed or run for them.
  const anyPhoto = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#808080" } }).png().toBuffer();
  assert.strictEqual(await detectImageType("closed_top", anyPhoto), "CLOSED_LAPTOP_FRONT");
  assert.strictEqual(await detectImageType("closed_angle", anyPhoto), "CLOSED_LAPTOP_FRONT");
  assert.strictEqual(await detectImageType("closed_rear", anyPhoto), "CLOSED_LAPTOP_BACK");
  assert.strictEqual(await detectImageType("left_side", anyPhoto), "SIDE_VIEW");
  assert.strictEqual(await detectImageType("right_side", anyPhoto), "SIDE_VIEW");
  assert.strictEqual(await detectImageType("custom", anyPhoto), "OTHER_PRODUCT_VIEW");
  assert.strictEqual(await detectImageType("bottom", anyPhoto), "OTHER_PRODUCT_VIEW");
  assert.strictEqual(await detectImageType("ports", anyPhoto), "OTHER_PRODUCT_VIEW");
  assert.strictEqual(await detectImageType("detail", anyPhoto), "OTHER_PRODUCT_VIEW");

  // 2. open_front/open_angle disambiguate screen on/off from the upper-
  //    center region's brightness — a dark region reads as OFF, anything
  //    with real brightness reads as ON.
  const darkScreenPhoto = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#0a0a0a" } }).png().toBuffer();
  assert.strictEqual(await detectImageType("open_front", darkScreenPhoto), "OPEN_LAPTOP_SCREEN_OFF");

  const litScreenPhoto = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#e0e0e0" } }).png().toBuffer();
  assert.strictEqual(await detectImageType("open_front", litScreenPhoto), "OPEN_LAPTOP_SCREEN_ON");
  assert.strictEqual(await detectImageType("open_angle", litScreenPhoto), "OPEN_LAPTOP_SCREEN_ON");

  console.log("productImageTypes.selftest: all assertions passed");
}

main().catch((err) => {
  console.error("productImageTypes.selftest FAILED:", err);
  process.exit(1);
});
