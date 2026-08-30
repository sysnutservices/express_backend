// Runnable self-check for imagekit.ts's format-conversion logic — no
// network call (uploadToImageKit/uploadUrlToImageKit themselves need a real
// ImageKit API key and would actually upload something), matching the
// codebase's no-framework selftest convention.
// Run: npx ts-node src/services/imagekit.selftest.ts (or `npm test`)
import assert from "assert";
import sharp from "sharp";
import { toWebpBuffer } from "./imagekit";

async function main() {
  // A plain PNG in, must come out as WebP bytes — this is the whole point
  // of the fix: every upload path (raw-file fallback, CRM URL sync, gallery
  // uploads) now converts through this one function before ever reaching
  // ImageKit, regardless of what format the source was.
  const pngBuffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  const webpBuffer = await toWebpBuffer(pngBuffer);
  const meta = await sharp(webpBuffer).metadata();
  assert.strictEqual(meta.format, "webp", "output must be WebP regardless of input format");

  // Already-webp input must convert cleanly too (a no-op in practice, but
  // must not throw or corrupt the bytes).
  const reconverted = await toWebpBuffer(webpBuffer);
  const meta2 = await sharp(reconverted).metadata();
  assert.strictEqual(meta2.format, "webp");

  console.log("imagekit.selftest: all assertions passed");
}

main();
