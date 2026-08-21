import sharp from "sharp";

// Ported from the Product Image Studio prototype's src/lib/processing/{background-removal,compose,settings}.ts.
// Trimmed for this integration: no progress callbacks, no uncertainty-score
// plumbing, no normalizeSettings/custom background (nothing here accepts
// untrusted settings JSON — v1 always runs with DEFAULT_SETTINGS), no
// min-dimension validation (product photos vary too much to hardcode a floor;
// add if PhotoRoom starts erroring on tiny inputs).

export type Position =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";
export type Padding = "compact" | "standard" | "spacious";
export type ProcessingSettings = {
  background: "white" | "transparent";
  position: Position;
  padding: Padding;
  shadow: boolean;
};

export const DEFAULT_SETTINGS: ProcessingSettings = {
  background: "white",
  position: "center",
  padding: "standard",
  shadow: false,
};

const MASTER_SIZE = 2000;

const PADDING_RATIOS: Record<Padding, number> = {
  compact: 0.04,
  standard: 0.08,
  spacious: 0.14,
};

const POSITION_ANCHORS: Record<Position, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 },
  "top-center": { x: 0.5, y: 0 },
  "top-right": { x: 1, y: 0 },
  "center-left": { x: 0, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  "center-right": { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 },
  "bottom-center": { x: 0.5, y: 1 },
  "bottom-right": { x: 1, y: 1 },
};

/**
 * Removes the background via the PhotoRoom Remove Background API, returning
 * a PNG buffer with alpha transparency. Isolated behind this one function so
 * swapping providers later doesn't touch the rest of the pipeline.
 * https://www.photoroom.com/api/docs/remove-background
 */
export async function removeBackground(inputBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const apiKey = process.env.PHOTOROOM_API_KEY;
  if (!apiKey) throw new Error("PHOTOROOM_API_KEY is not set");
  // Sandbox mode doesn't consume paid credits — flip on in dev/test via env
  // so iterating on this doesn't burn the real quota.
  const keyHeader = process.env.PHOTOROOM_SANDBOX === "true" ? `sandbox_${apiKey}` : apiKey;

  const form = new FormData();
  form.append("image_file", new Blob([new Uint8Array(inputBuffer)], { type: mimeType }), "source");

  const res = await fetch("https://sdk.photoroom.com/v1/segment", {
    method: "POST",
    headers: { "x-api-key": keyHeader },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Background removal failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Composes a cleaned (background-removed) product cutout onto the studio
 * canvas per the given settings: trim -> fit into padded square -> position
 * -> optional drop shadow -> background. Pure function of its inputs.
 */
export async function composeStudioImage(
  cleanedBuffer: Buffer,
  settings: ProcessingSettings = DEFAULT_SETTINGS
): Promise<Buffer> {
  let productBuffer = cleanedBuffer;
  try {
    productBuffer = await sharp(cleanedBuffer).trim().toBuffer();
  } catch {
    // Edges weren't uniform enough to trim (e.g. already tight crop) — use
    // the untrimmed cutout, composition below still centers it correctly.
  }

  const maxProductSize = Math.round(MASTER_SIZE * (1 - 2 * PADDING_RATIOS[settings.padding]));
  const resizedProduct = await sharp(productBuffer)
    .resize({ width: maxProductSize, height: maxProductSize, fit: "inside" })
    .toBuffer();
  const resizedMeta = await sharp(resizedProduct).metadata();
  const productWidth = resizedMeta.width ?? maxProductSize;
  const productHeight = resizedMeta.height ?? maxProductSize;

  const anchor = POSITION_ANCHORS[settings.position];
  const left = Math.round(anchor.x * (MASTER_SIZE - productWidth));
  const top = Math.round(anchor.y * (MASTER_SIZE - productHeight));

  const compositeLayers: { input: Buffer; left: number; top: number }[] = [];
  if (settings.shadow) {
    // Soft drop shadow: blur the product's own alpha silhouette, fade it
    // to ~35% opacity, offset it down a few px, composite underneath.
    const shadowOffset = Math.round(MASTER_SIZE * 0.015);
    const shadowBlur = Math.round(MASTER_SIZE * 0.02);
    const shadowAlpha = await sharp(resizedProduct)
      .ensureAlpha()
      .extractChannel(3)
      .linear(0.35, 0)
      .blur(shadowBlur)
      .toBuffer();
    const shadowLayer = await sharp({
      create: { width: productWidth, height: productHeight, channels: 3, background: "#000000" },
    })
      .joinChannel(shadowAlpha)
      .png()
      .toBuffer();
    compositeLayers.push({ input: shadowLayer, left, top: top + shadowOffset });
  }
  compositeLayers.push({ input: resizedProduct, left, top });

  let masterPipeline = sharp({
    create: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(compositeLayers);
  if (settings.background !== "transparent") {
    masterPipeline = masterPipeline.flatten({ background: "#ffffff" });
  }
  return masterPipeline.webp({ quality: 92 }).toBuffer();
}

/** Full pipeline: remove background -> light cleanup -> studio composite. */
export async function processProductImage(inputBuffer: Buffer, mimeType: string): Promise<Buffer> {
  const cutout = await removeBackground(inputBuffer, mimeType);
  const cleaned = await sharp(cutout).normalize().sharpen({ sigma: 0.5 }).toBuffer();
  return composeStudioImage(cleaned, DEFAULT_SETTINGS);
}
