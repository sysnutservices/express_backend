import fs from "fs";
import https from "https";
import path from "path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

// Deterministic, non-generative background removal — the default catalogue
// pipeline. Unlike OpenAI's image edit, this NEVER touches product pixels:
// every pixel inside the detected product silhouette is byte-identical to
// the original photograph. Benchmarked against a real LapShark product photo
// (branded studio backdrop, dark chassis, screen content) before adoption —
// see the ThinkPad L480 regression check in localSegmentation.selftest.ts.
//
// Model: IS-Net general-use (Apache 2.0 — danielgatis/rembg's default model,
// genuinely free for commercial use, unlike AGPL-licensed wrapper packages).
// Downloaded on first use (178MB), cached in models/ (gitignored).
const MODEL_DIR = path.join(process.cwd(), "models");
const MODEL_PATH = path.join(MODEL_DIR, "isnet-general-use.onnx");
const MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx";

const INPUT_SIZE = 1024;
// Generous — only seeds which pixels count as "possibly foreground" for the
// connected-component step below; the final cutoff is BBOX_THRESHOLD.
const CCL_SEED_THRESHOLD = 180;
// Final alpha cutoff, applied only AFTER the mask is resized to full
// resolution — thresholding a binary mask BEFORE a large upscale causes
// lanczos ringing (confirmed empirically), so the resize always runs on the
// continuous probability mask first.
const BBOX_THRESHOLD = 200;
// Fills small notches the CCL step leaves right at a boundary with removed
// clutter (the model's confidence dips slightly on real product pixels
// immediately next to high-contrast background noise). Small enough to not
// visibly change the silhouette shape.
const MORPH_RADIUS = 3;

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = (currentUrl: string) => {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Segmentation model download failed: HTTP ${res.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
          file.on("error", reject);
        })
        .on("error", reject);
    };
    request(url);
  });
}

async function ensureModel(): Promise<void> {
  if (fs.existsSync(MODEL_PATH)) return;
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  const tmpPath = `${MODEL_PATH}.download`;
  await downloadFile(MODEL_URL, tmpPath);
  fs.renameSync(tmpPath, MODEL_PATH);
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;
function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      await ensureModel();
      return ort.InferenceSession.create(MODEL_PATH);
    })();
  }
  return sessionPromise;
}

interface BBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AlphaStats {
  alphaMin: number;
  alphaMax: number;
  transparentPercent: number;
}

// Run on the FULL-FRAME mask, before any bbox crop trims the transparent
// margin away — cropping is expected to leave little/no transparency in the
// output (that's a tight, correct crop, not a failure), so validating after
// crop would misread a good result as broken. alphaMax === alphaMin means
// the model found either everything or nothing to be background: a real
// segmentation, run on a real product photo, always produces a mix.
export function computeAlphaStats(alpha: Uint8Array): AlphaStats {
  let alphaMin = 255,
    alphaMax = 0,
    transparentCount = 0;
  for (let i = 0; i < alpha.length; i++) {
    const a = alpha[i];
    if (a < alphaMin) alphaMin = a;
    if (a > alphaMax) alphaMax = a;
    if (a === 0) transparentCount++;
  }
  return { alphaMin, alphaMax, transparentPercent: (transparentCount / alpha.length) * 100 };
}

export function computeBBoxFromMask(mask: Uint8Array, width: number, height: number, threshold: number): BBox | null {
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

// Iterative BFS connected-component labeling (4-connectivity). Keeps only the
// single largest foreground blob — the product is one large connected
// region; background clutter (a backdrop's text/graphics near the product)
// is a separate, smaller, disconnected region regardless of how much
// confidence the model gave it.
export function largestComponentMask(binary: Uint8Array, width: number, height: number): Uint8Array {
  const visited = new Uint8Array(width * height);
  const keep = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let bestSize = 0;
  let bestPixels: number[] = [];

  for (let start = 0; start < width * height; start++) {
    if (binary[start] === 0 || visited[start]) continue;
    let qHead = 0,
      qTail = 0;
    queue[qTail++] = start;
    visited[start] = 1;
    const pixels: number[] = [start];
    while (qHead < qTail) {
      const p = queue[qHead++];
      const x = p % width,
        y = (p / width) | 0;
      if (x > 0 && binary[p - 1] && !visited[p - 1]) {
        visited[p - 1] = 1;
        queue[qTail++] = p - 1;
        pixels.push(p - 1);
      }
      if (x < width - 1 && binary[p + 1] && !visited[p + 1]) {
        visited[p + 1] = 1;
        queue[qTail++] = p + 1;
        pixels.push(p + 1);
      }
      if (y > 0 && binary[p - width] && !visited[p - width]) {
        visited[p - width] = 1;
        queue[qTail++] = p - width;
        pixels.push(p - width);
      }
      if (y < height - 1 && binary[p + width] && !visited[p + width]) {
        visited[p + width] = 1;
        queue[qTail++] = p + width;
        pixels.push(p + width);
      }
    }
    if (pixels.length > bestSize) {
      bestSize = pixels.length;
      bestPixels = pixels;
    }
  }
  for (const p of bestPixels) keep[p] = 1;
  return keep;
}

// Flood-fills any 0-valued region of `binary` that is NOT reachable from the
// image border — i.e. holes fully enclosed by the kept silhouette. Exists
// because the segmentation model has a "salient subject" bias: vivid,
// detailed on-screen content (a rendered face or character) can score higher
// as its own subject than the surrounding screen, so the model excludes
// large legitimate patches of the laptop's own display (confirmed live: a
// wallpaper's face was kept, the rest of that same screen was not). A real
// laptop never has an actual hole through its middle showing background —
// so any enclosed low-confidence patch inside the product's own silhouette
// is product, regardless of the model's per-pixel confidence there.
export function fillEnclosedHoles(binary: Uint8Array, width: number, height: number): Uint8Array {
  const reachableFromBorder = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let qHead = 0,
    qTail = 0;

  const tryPush = (idx: number) => {
    if (binary[idx] === 0 && !reachableFromBorder[idx]) {
      reachableFromBorder[idx] = 1;
      queue[qTail++] = idx;
    }
  };
  for (let x = 0; x < width; x++) {
    tryPush(x);
    tryPush((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    tryPush(y * width);
    tryPush(y * width + width - 1);
  }

  while (qHead < qTail) {
    const p = queue[qHead++];
    const x = p % width,
      y = (p / width) | 0;
    if (x > 0) tryPush(p - 1);
    if (x < width - 1) tryPush(p + 1);
    if (y > 0) tryPush(p - width);
    if (y < height - 1) tryPush(p + width);
  }

  const filled = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) filled[i] = binary[i] || !reachableFromBorder[i] ? 1 : 0;
  return filled;
}

// Separable box max/min filter — sharp 0.33 has no dilate()/erode(), this is
// a standard cheap approximation of disk-shaped morphology for a small radius.
export function boxMorph(src: Uint8Array, width: number, height: number, radius: number, isMax: boolean): Uint8Array {
  const tmp = new Uint8Array(width * height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = isMax ? 0 : 255;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const s = src[y * width + xx];
        v = isMax ? Math.max(v, s) : Math.min(v, s);
      }
      tmp[y * width + x] = v;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = isMax ? 0 : 255;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        const s = tmp[yy * width + x];
        v = isMax ? Math.max(v, s) : Math.min(v, s);
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

export interface FullFrameAlpha {
  alpha: Buffer; // one byte per pixel, 0 or 255, row-major, width*height long
  width: number;
  height: number;
}

// The full segmentation pipeline (model inference, largest-component,
// hole-fill, opening, closing) resized back to the ORIGINAL photo's own
// resolution — no bbox crop. Used by removeBackgroundLocal, which crops it
// for the catalogue_safe cutout. Split out as its own function so the
// pre-crop alpha is independently testable/reusable, not because anything
// else currently consumes it.
export async function segmentFullFrameAlpha(inputBuffer: Buffer): Promise<FullFrameAlpha> {
  const session = await getSession();
  const meta = await sharp(inputBuffer).metadata();
  if (!meta.width || !meta.height) throw new Error("Could not read image dimensions");

  const { data } = await sharp(inputBuffer)
    .removeAlpha()
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = INPUT_SIZE * INPUT_SIZE;
  const floatData = new Float32Array(3 * pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    floatData[i] = data[i * 3] / 255 - 0.5;
    floatData[pixelCount + i] = data[i * 3 + 1] / 255 - 0.5;
    floatData[2 * pixelCount + i] = data[i * 3 + 2] / 255 - 0.5;
  }
  const inputTensor = new ort.Tensor("float32", floatData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const results = await session.run({ [session.inputNames[0]]: inputTensor });
  const outData = results[session.outputNames[0]].data as Float32Array;

  let mn = Infinity,
    mx = -Infinity;
  for (let i = 0; i < outData.length; i++) {
    if (outData[i] < mn) mn = outData[i];
    if (outData[i] > mx) mx = outData[i];
  }
  const range = mx - mn || 1;
  const smallMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) smallMask[i] = Math.round(((outData[i] - mn) / range) * 255);

  const binary = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) binary[i] = smallMask[i] > CCL_SEED_THRESHOLD ? 1 : 0;
  const keep = largestComponentMask(binary, INPUT_SIZE, INPUT_SIZE);
  const filled = fillEnclosedHoles(keep, INPUT_SIZE, INPUT_SIZE);

  const cleanedSmallMask = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    // A hole the fill step added (filled but not in the model's own kept
    // region) is trusted at full confidence — the model's raw score there is
    // exactly what got it excluded in the first place, so re-using it here
    // would undo the fill.
    if (filled[i] && !keep[i]) cleanedSmallMask[i] = 255;
    else cleanedSmallMask[i] = keep[i] ? smallMask[i] : 0;
  }

  // Opening (erode then dilate) strips thin protrusions that survived the
  // largest-component filter only because they touch the product's true
  // silhouette in the downsampled 1024x1024 mask — confirmed live: a studio
  // backdrop's text sitting just above a laptop's lid was close enough to
  // merge into the very same connected component the model produced, before
  // any closing/notch-fill step ever ran. The laptop's own bulk is far
  // thicker than OPEN_RADIUS and survives erosion intact; a background
  // speck a few pixels wide does not survive to be dilated back.
  const OPEN_RADIUS = 4;
  const binaryForOpen = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) binaryForOpen[i] = cleanedSmallMask[i] > 100 ? 255 : 0;
  const eroded = boxMorph(binaryForOpen, INPUT_SIZE, INPUT_SIZE, OPEN_RADIUS, false);
  const opened = boxMorph(eroded, INPUT_SIZE, INPUT_SIZE, OPEN_RADIUS, true);
  for (let i = 0; i < pixelCount; i++) {
    if (opened[i] === 0) cleanedSmallMask[i] = 0;
  }

  const binaryForMorph = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) binaryForMorph[i] = cleanedSmallMask[i] > 100 ? 255 : 0;
  const dilated = boxMorph(binaryForMorph, INPUT_SIZE, INPUT_SIZE, MORPH_RADIUS, true);
  const closed = boxMorph(dilated, INPUT_SIZE, INPUT_SIZE, MORPH_RADIUS, false);
  for (let i = 0; i < pixelCount; i++) {
    if (closed[i] > 127 && cleanedSmallMask[i] === 0) cleanedSmallMask[i] = 255;
  }

  // Resize the CONTINUOUS mask with fit:"fill" — must match the fit:"fill"
  // used for the model input above, or the mask misaligns against the real
  // image (confirmed empirically: "cover", sharp's default, silently crops
  // the mask against the wrong aspect ratio).
  const { data: resizedMask } = await sharp(Buffer.from(cleanedSmallMask), {
    raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 },
  })
    .resize(meta.width, meta.height, { kernel: "lanczos3", fit: "fill" })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const finalAlpha = Buffer.alloc(resizedMask.length);
  for (let i = 0; i < resizedMask.length; i++) finalAlpha[i] = resizedMask[i] > BBOX_THRESHOLD ? 255 : 0;

  // Hard failure, not a soft warning — a mask with zero contrast means
  // segmentation didn't actually run correctly on this photo, so nothing
  // downstream can be trusted. computeBBoxFromMask below already throws for
  // the all-background case (bbox null); this catches the other degenerate
  // case it can't: everything read as foreground.
  const alphaStats = computeAlphaStats(finalAlpha);
  if (alphaStats.alphaMax === alphaStats.alphaMin) {
    throw new Error(
      `BACKGROUND_REMOVAL_FAILED — no transparency detected (alphaMin=${alphaStats.alphaMin}, alphaMax=${alphaStats.alphaMax})`
    );
  }

  return { alpha: finalAlpha, width: meta.width, height: meta.height };
}

// Returns an RGBA PNG cutout, already cropped tightly to the detected
// product's bounding box — a drop-in replacement for PhotoRoom's
// removeBackground() as the input to composeStudioImage/renderStudioImage
// in imageProcessing.ts (same downstream Sharp compositing, unchanged).
export async function removeBackgroundLocal(inputBuffer: Buffer): Promise<Buffer> {
  const { alpha: finalAlpha, width, height } = await segmentFullFrameAlpha(inputBuffer);

  const bbox = computeBBoxFromMask(finalAlpha, width, height, 127);
  if (!bbox) throw new Error("No product detected in image");

  const rgbBuffer = await sharp(inputBuffer).removeAlpha().raw().toBuffer();
  // Materialize before extract() — chaining joinChannel().extract() directly
  // silently no-ops the crop (a sharp chaining quirk, confirmed empirically).
  const rgba = await sharp(rgbBuffer, { raw: { width, height, channels: 3 } })
    .joinChannel(finalAlpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
  return sharp(rgba).extract(bbox).png().toBuffer();
}
