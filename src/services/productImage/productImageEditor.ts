import sharp from "sharp";
import { ProductViewType } from "../imageProcessing";
import { editImage, OpenAIEditResult } from "../openaiClient";
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

// The one entry point for ai_edit mode's OpenAI call — detects the image
// type, builds the matching prompt, runs the edit, and refuses the result
// outright if OpenAI silently changed the product's orientation (a cheap,
// reliable geometry sanity check — not a full product-fidelity judgment,
// just a hard stop on the specific "device got rotated" failure mode).
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
  const result = await editImage(originalBuffer, mimeType, prompt, size);

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
