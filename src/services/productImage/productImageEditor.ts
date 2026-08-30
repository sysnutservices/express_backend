import sharp from "sharp";
import { ProductViewType } from "../imageProcessing";
import { editImage, OpenAIEditResult } from "../openaiClient";
import { segmentFullFrameAlpha } from "../localSegmentation";
import { detectImageType, ProductImageType } from "./productImageTypes";
import { buildProductImagePrompt } from "./productImagePrompts";

// Matches the source photo's own aspect ratio — NOT a fixed square. An
// earlier version of this file forced every edit request to "1024x1024"
// regardless of the source's shape, on the theory that the new prompt asks
// OpenAI to center/compose the product itself. That combination (force a
// non-square photo into a square canvas + tell the model it owns
// composition) is exactly the kind of thing that invites a generative model
// to reinterpret orientation — confirmed live: a landscape/portrait source
// came back as a vertically-rotated device, keyboard and trackpad gone.
// Composition is Sharp's job everywhere else in this pipeline (see
// composeStudioImage) and it's Sharp's job here too — OpenAI only ever
// edits the photo it's given, in the shape it's given, matching
// catalogue_safe's own (never-broken) sizing discipline.
const EDIT_MAX_DIMENSION = 1536; // stays under gpt-image-2's "experimental above 2560x1440" tier
const EDIT_MIN_DIMENSION = 512;

export function computeEditSize(width: number, height: number): string {
  const scale = Math.min(1, EDIT_MAX_DIMENSION / Math.max(width, height));
  let w = Math.round((width * scale) / 16) * 16;
  let h = Math.round((height * scale) / 16) * 16;
  w = Math.max(EDIT_MIN_DIMENSION, w);
  h = Math.max(EDIT_MIN_DIMENSION, h);
  // gpt-image-2 requires the aspect ratio to stay within 1:3..3:1.
  if (w / h > 3) w = h * 3;
  if (h / w > 3) h = w * 3;
  return `${w}x${h}`;
}

// Distinguishable from a plain Error so the orchestrator's retry loop can
// treat it as worth retrying (it's model unpredictability on this specific
// attempt, not invalid input or a content-policy rejection — a second
// generation has a real chance of preserving orientation correctly).
export class GeometryMismatchError extends Error {}

export type Orientation = "landscape" | "portrait" | "square";
export function orientationOf(width: number, height: number): Orientation {
  const ratio = width / height;
  if (ratio > 1.15) return "landscape";
  if (ratio < 1 / 1.15) return "portrait";
  return "square";
}

export interface ProductImageEditResult extends OpenAIEditResult {
  imageType: ProductImageType;
}

// Distinguishable from a plain Error for the same reason as
// GeometryMismatchError — the orchestrator retries both the same way (model
// unpredictability on this one attempt, not invalid input). Fires when
// OpenAI changed pixels inside the mask's preserved (opaque) region.
// Preservation is SUPPOSED to be structurally guaranteed by the mask (see
// buildPreserveMask below), but gpt-image-2's actual mask compliance was
// never confirmed against a live call — the docs promise it and dall-e-2
// always honored it, but this is the real, ongoing verification instead of
// trusting that blindly. If this fires on every attempt in production,
// that's the signal the mask semantics don't hold for this model — not
// something to silently work around here.
export class MaskViolationError extends Error {}

// Generous enough to absorb PNG/JPEG re-encode noise across a resize, tight
// enough to catch an actually hallucinated region (a redrawn keyboard, a
// changed on-screen date) — not a full fidelity judgment, same spirit as
// the geometry check below.
export const MASK_VIOLATION_MEAN_DIFF_THRESHOLD = 18;

// Builds an OpenAI edit mask (opaque = preserve exactly, transparent = free
// to regenerate) from the SAME local segmentation catalogue_safe already
// relies on — every segmentation fix (speck-strip, hole-fill) improves this
// mask too, for free, since it's the identical function.
async function buildPreserveMask(
  originalBuffer: Buffer
): Promise<{ mask: Buffer; alpha: Buffer; width: number; height: number }> {
  const { alpha, width, height } = await segmentFullFrameAlpha(originalBuffer);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const preserve = alpha[i] > 127;
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = preserve ? 255 : 0;
  }
  const mask = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { mask, alpha, width, height };
}

// Resizes the source and its own mask down to the edit's output canvas size
// and compares mean pixel difference inside the preserved region only.
export async function verifyMaskRespected(
  originalBuffer: Buffer,
  alpha: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  resultBuffer: Buffer,
  editWidth: number,
  editHeight: number
): Promise<boolean> {
  const [sourceResized, resultResized, alphaResized] = await Promise.all([
    sharp(originalBuffer).removeAlpha().resize(editWidth, editHeight, { fit: "fill" }).raw().toBuffer(),
    sharp(resultBuffer).removeAlpha().resize(editWidth, editHeight, { fit: "fill" }).raw().toBuffer(),
    // .extractChannel(0) after resize is load-bearing, not decorative — sharp
    // silently promotes a resized single-channel raw buffer to 3 channels
    // otherwise (confirmed empirically; see the identical note in
    // localSegmentation.ts's own mask resize for the first time this bit us).
    sharp(alpha, { raw: { width: sourceWidth, height: sourceHeight, channels: 1 } })
      .resize(editWidth, editHeight, { kernel: "lanczos3", fit: "fill" })
      .extractChannel(0)
      .raw()
      .toBuffer(),
  ]);

  let sumDiff = 0;
  let preservedPixels = 0;
  const pixelCount = editWidth * editHeight;
  for (let i = 0; i < pixelCount; i++) {
    if (alphaResized[i] <= 127) continue; // only checking the preserved region
    preservedPixels++;
    const s = i * 3;
    sumDiff +=
      Math.abs(sourceResized[s] - resultResized[s]) +
      Math.abs(sourceResized[s + 1] - resultResized[s + 1]) +
      Math.abs(sourceResized[s + 2] - resultResized[s + 2]);
  }
  if (preservedPixels === 0) return true; // segmentFullFrameAlpha already refuses a degenerate (all-or-nothing) mask, so this shouldn't happen
  return sumDiff / (preservedPixels * 3) <= MASK_VIOLATION_MEAN_DIFF_THRESHOLD;
}

// The one entry point for ai_edit mode's OpenAI call — detects the image
// type, builds the matching prompt and preserve-mask, runs the edit, and
// refuses the result outright if OpenAI either altered the masked product
// region or silently changed its orientation (two cheap, reliable sanity
// checks — not a full product-fidelity judgment, just hard stops on the
// specific failure modes this pipeline has actually hit).
// Nothing else in the codebase should call openaiClient.editImage directly
// for product photos.
export async function editProductImage(
  originalBuffer: Buffer,
  mimeType: string,
  viewType: ProductViewType
): Promise<ProductImageEditResult> {
  const sourceMeta = await sharp(originalBuffer).metadata();
  const size = sourceMeta.width && sourceMeta.height ? computeEditSize(sourceMeta.width, sourceMeta.height) : "1024x1024";

  const imageType = await detectImageType(viewType, originalBuffer);
  const prompt = buildProductImagePrompt(imageType);
  const { mask, alpha, width: maskWidth, height: maskHeight } = await buildPreserveMask(originalBuffer);
  const result = await editImage(originalBuffer, mimeType, prompt, size, mask);

  const [editWidth, editHeight] = size.split("x").map(Number);
  const maskRespected = await verifyMaskRespected(originalBuffer, alpha, maskWidth, maskHeight, result.buffer, editWidth, editHeight);
  if (!maskRespected) {
    throw new MaskViolationError("AI edit altered pixels inside the masked (preserved) product region — refusing this result");
  }

  if (sourceMeta.width && sourceMeta.height) {
    const sourceOrientation = orientationOf(sourceMeta.width, sourceMeta.height);
    if (sourceOrientation !== "square") {
      const outMeta = await sharp(result.buffer).metadata();
      if (outMeta.width && outMeta.height && orientationOf(outMeta.width, outMeta.height) !== sourceOrientation) {
        throw new GeometryMismatchError(
          `AI edit changed the product's orientation (source was ${sourceOrientation}, result was ${orientationOf(outMeta.width, outMeta.height)}) — refusing this result`
        );
      }
    }
  }

  return { ...result, imageType };
}
