// Runnable self-check for imageProcessing.ts — no test framework, just
// assert(). Exercises pure math (scale/position/merge) plus a real Sharp
// round-trip (trim -> compose -> variants) against a synthetic transparent
// PNG, so it never calls the network (PhotoRoom).
//
// Run: npx ts-node src/services/imageProcessing.selftest.ts  (or `npm test`)
import assert from "assert";
import sharp from "sharp";
import {
  VIEW_PRESETS,
  DEFAULT_ENHANCEMENT,
  computeTargetSize,
  computePosition,
  composeStudioImage,
  generateVariants,
  validateMasterImage,
  resolveViewSettings,
  computeOccupancy,
  flattenMasterToWhite,
  analyzeExposure,
  analyzeReflection,
  StudioSettings,
} from "./imageProcessing";

async function main() {
  // 1. View preset table has every documented angle.
  const expectedViews = [
    "open_front", "open_angle", "closed_top", "closed_angle", "bottom",
    "left_side", "right_side", "ports", "detail", "custom",
  ] as const;
  for (const v of expectedViews) {
    assert.ok(VIEW_PRESETS[v], `missing view preset: ${v}`);
    assert.ok(VIEW_PRESETS[v].scale > 0 && VIEW_PRESETS[v].scale <= 1, `${v} scale out of range`);
  }

  // 2. Scale calculation: spec's worked example (canvas 2000, scale 0.86 -> ~1720).
  assert.strictEqual(computeTargetSize(2000, 0.86), 1720);
  assert.strictEqual(computeTargetSize(2000, 1), 2000);

  // 3. Position calculation: center anchor centers exactly; center-bottom sits
  //    at the bottom edge before offset; offsets shift as expected; extreme
  //    offsets clamp to stay on-canvas.
  assert.deepStrictEqual(computePosition(2000, 2000, 1000, 1000, "center"), { left: 500, top: 500 });
  assert.deepStrictEqual(computePosition(2000, 2000, 1000, 1000, "center-bottom", 0, -20), { left: 500, top: 980 });
  assert.deepStrictEqual(computePosition(2000, 2000, 1000, 1000, "center", 0, 100000), { left: 500, top: 1000 });
  assert.deepStrictEqual(computePosition(2000, 2000, 1000, 1000, "center", 0, -100000), { left: 500, top: 0 });

  // 4. Settings merge priority: DEFAULT_ENHANCEMENT -> VIEW_PRESET -> manual, manual always wins.
  const preset = VIEW_PRESETS.open_front;
  const manual = { scale: 0.5, brightness: 1.1 };
  const merged = { ...DEFAULT_ENHANCEMENT, ...preset, ...manual };
  assert.strictEqual(merged.scale, 0.5, "manual scale should win over preset");
  assert.strictEqual(merged.brightness, 1.1, "manual brightness should win over default");
  assert.strictEqual(merged.contrast, 1, "unset contrast should fall back to default");
  assert.strictEqual(merged.position, preset.position, "unset position should fall back to preset");

  // 4b. resolveViewSettings: every preset now defaults shadow to true; the
  //     ENABLE_SHADOW=false global kill switch turns it off, but only when
  //     the caller didn't already pass an explicit shadow value of their own.
  const prevEnableShadow = process.env.ENABLE_SHADOW;
  delete process.env.ENABLE_SHADOW;
  assert.strictEqual(resolveViewSettings("open_front").shadow, true, "shadow defaults on");
  process.env.ENABLE_SHADOW = "false";
  assert.strictEqual(resolveViewSettings("open_front").shadow, false, "ENABLE_SHADOW=false must disable shadow globally");
  assert.strictEqual(resolveViewSettings("open_front", { shadow: true }).shadow, true, "an explicit caller override still wins over the kill switch");
  if (prevEnableShadow === undefined) delete process.env.ENABLE_SHADOW; else process.env.ENABLE_SHADOW = prevEnableShadow;

  // 5. End-to-end composite + variants on a synthetic cutout: non-square
  //    source (aspect ratio must be preserved), padded with transparent
  //    margin (must be trimmed before scaling).
  const productW = 400, productH = 200;
  const padding = 300;
  const cutout = await sharp({
    create: {
      width: productW + padding * 2,
      height: productH + padding * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: await sharp({ create: { width: productW, height: productH, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } }).png().toBuffer(),
      left: padding,
      top: padding,
    }])
    .png()
    .toBuffer();

  const settings: StudioSettings = { canvasSize: 2000, scale: 0.86, position: "center", background: "#ffffff", shadow: false };
  const master = await composeStudioImage(cutout, settings);
  const masterMeta = await sharp(master).metadata();
  assert.strictEqual(masterMeta.width, 2000, "master width must be exactly 2000");
  assert.strictEqual(masterMeta.height, 2000, "master height must be exactly 2000");

  // Aspect ratio preserved: the trimmed product was 2:1, so within the
  // composited master the visible (non-white) bounding box should still be ~2:1.
  const flattenedBack = await sharp(master).flatten({ background: "#ffffff" }).toBuffer();
  const trimmedBuffer = await sharp(flattenedBack).trim({ background: "#ffffff" }).toBuffer();
  const trimmedBack = await sharp(trimmedBuffer).metadata();
  const ratio = (trimmedBack.width ?? 0) / (trimmedBack.height ?? 1);
  assert.ok(Math.abs(ratio - 2) < 0.15, `aspect ratio not preserved: got ${ratio}`);

  const variants = await generateVariants(master);
  assert.strictEqual(variants.master.width, 2000);
  assert.strictEqual(variants.product.width, 1200);
  assert.strictEqual(variants.product.height, 1200);
  assert.strictEqual(variants.thumbnail.width, 500);
  assert.strictEqual(variants.thumbnail.height, 500);
  const productMeta = await sharp(variants.product.buffer).metadata();
  assert.strictEqual(productMeta.width, 1200);
  const thumbMeta = await sharp(variants.thumbnail.buffer).metadata();
  assert.strictEqual(thumbMeta.width, 500);

  // 6. validateMasterImage: a well-formed master (this one — proper size,
  //    real occupancy, clean white corners) passes clean; synthetic
  //    obviously-broken masters get flagged instead of silently approved.
  assert.strictEqual(await validateMasterImage(master), null, "a valid master must not be flagged");

  const wrongSize = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
  assert.ok((await validateMasterImage(wrongSize))?.includes("dimensions"), "wrong dimensions must be flagged");

  const tinyProduct = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#ffffff" } })
    .composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 3, background: "#000000" } }).png().toBuffer(), left: 980, top: 980 }])
    .png()
    .toBuffer();
  assert.ok((await validateMasterImage(tinyProduct))?.includes("whitespace"), "a near-empty frame must be flagged");

  const offWhiteBg = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "#e0e0e0" } })
    .composite([{ input: await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#000000" } }).png().toBuffer(), left: 200, top: 200 }])
    .png()
    .toBuffer();
  assert.ok((await validateMasterImage(offWhiteBg))?.includes("white"), "a non-white background corner must be flagged");

  // 7. computeOccupancy: the master above was composed at scale 0.86, so its
  //    longest trimmed dimension should occupy roughly 86% of the canvas.
  const occupancy = await computeOccupancy(master);
  assert.ok(occupancy >= 80 && occupancy <= 90, `occupancy out of expected range: ${occupancy}%`);

  // 8. flattenMasterToWhite: derives the opaque white-background version
  //    from a transparent one via a flatten, not a re-composite — must end
  //    up with no alpha channel and a pure-white corner.
  const transparentTestMaster = await sharp({
    create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } }).png().toBuffer(),
      left: 50,
      top: 50,
    }])
    .png()
    .toBuffer();
  const flattened = await flattenMasterToWhite(transparentTestMaster, "png");
  const flattenedMeta = await sharp(flattened).metadata();
  assert.strictEqual(flattenedMeta.hasAlpha, false, "flattened white version must have no alpha channel");
  const flattenedCorner = await sharp(flattened).extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer();
  assert.deepStrictEqual(Array.from(flattenedCorner), [255, 255, 255], "flattened corner must be pure white");

  // 9. analyzeExposure: a uniformly dark image needs a capped brightness
  //    boost; a reasonably exposed, reasonably varied image needs nothing.
  const darkBuffer = Buffer.alloc(100 * 100 * 3, 40);
  const darkPng = await sharp(darkBuffer, { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
  const darkExposure = await analyzeExposure(darkPng);
  assert.ok(darkExposure.brightness > 1, "a dark image should get a brightness boost");
  assert.ok(darkExposure.brightness <= 1.08, "brightness boost must stay within the +8% cap");
  assert.strictEqual(darkExposure.needsCorrection, true);

  const healthyBuffer = Buffer.alloc(100 * 100 * 3);
  for (let i = 0; i < healthyBuffer.length; i += 3) {
    const v = Math.floor(i / 3) % 2 === 0 ? 80 : 180; // mean 130, stdev 50 — inside the healthy band
    healthyBuffer[i] = healthyBuffer[i + 1] = healthyBuffer[i + 2] = v;
  }
  const healthyPng = await sharp(healthyBuffer, { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
  const healthyExposure = await analyzeExposure(healthyPng);
  assert.strictEqual(healthyExposure.needsCorrection, false, "a well-exposed, varied image should need no correction");

  // 10. analyzeReflection: a small near-white hotspot on an otherwise darker
  //     product is flagged; a naturally bright/silver product (uniformly
  //     near-white) is not — the whole point is not to flag every silver
  //     laptop as having a reflection problem.
  const w = 100, h = 100;
  const hotspotBuf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    hotspotBuf[o] = hotspotBuf[o + 1] = hotspotBuf[o + 2] = 60;
    hotspotBuf[o + 3] = 255;
  }
  for (let y = 40; y < 53; y++) {
    for (let x = 40; x < 53; x++) {
      const o = (y * w + x) * 4;
      hotspotBuf[o] = hotspotBuf[o + 1] = hotspotBuf[o + 2] = 253; // 169px hotspot = 1.69%
    }
  }
  const hotspotPng = await sharp(hotspotBuf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const hotspotResult = await analyzeReflection(hotspotPng);
  assert.strictEqual(hotspotResult.detected, true, "a small bright hotspot on a darker product should be flagged");
  assert.ok(hotspotResult.hotspotPercent > 1 && hotspotResult.hotspotPercent < 3);

  const brightProductBuf = Buffer.alloc(w * h * 4, 252);
  for (let i = 3; i < brightProductBuf.length; i += 4) brightProductBuf[i] = 255; // alpha channel
  const brightProductPng = await sharp(brightProductBuf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const brightResult = await analyzeReflection(brightProductPng);
  assert.strictEqual(brightResult.detected, false, "a naturally bright/silver product must not be flagged as glare");

  console.log("imageProcessing.selftest: all assertions passed");
}

main().catch((err) => {
  console.error("imageProcessing.selftest FAILED:", err);
  process.exit(1);
});
