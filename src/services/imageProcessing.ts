import sharp from "sharp";

// Ported from the Product Image Studio prototype's src/lib/processing/{background-removal,compose,settings}.ts.
// Trimmed for this integration: no progress callbacks, no uncertainty-score
// plumbing, no normalizeSettings/custom background (nothing here accepts
// untrusted settings JSON — v1 always runs with DEFAULT_SETTINGS), no
// min-dimension validation (product photos vary too much to hardcode a floor;
// add if PhotoRoom starts erroring on tiny inputs).
//
// v2: view-type presets (open_front/closed_top/.../custom) so each laptop
// angle gets its own scale/position/shadow instead of one fixed composition.
// PhotoRoom still only does background removal — everything about size,
// position, padding and shadow is decided here, in Sharp, from the trimmed
// cutout's real bounding box (never PhotoRoom's raw output dimensions).

export type Position =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right"
  // v2 aliases used by VIEW_PRESETS/API callers — mapped to the anchors
  // above so both naming schemes resolve to the same table.
  | "center-top" | "center-bottom" | "left" | "right";
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
  // v2 aliases
  "center-top": { x: 0.5, y: 0 },
  "center-bottom": { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
};

// ==================================================
// v2: per-angle composition
// ==================================================

export type ProductViewType =
  | "open_front"
  | "closed_top"
  | "closed_rear"
  | "bottom"
  | "left_side"
  | "right_side"
  | "custom";

export interface ViewPreset {
  scale: number;
  position: Position;
  shadow: boolean;
  xOffset?: number;
  yOffset?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
}

// Explicit per-view occupancy/position/shadow instead of one fixed
// compact/standard/spacious padding for every angle. Tune freely per view —
// nothing else in the pipeline depends on these specific numbers.
export const VIEW_PRESETS: Record<ProductViewType, ViewPreset> = {
  open_front: { scale: 0.88, position: "center-bottom", shadow: true, shadowOffsetY: 24 },
  closed_top: { scale: 0.86, position: "center", shadow: false },
  closed_rear: { scale: 0.84, position: "center", shadow: true, shadowOffsetY: 18 },
  bottom: { scale: 0.86, position: "center", shadow: false },
  left_side: { scale: 0.82, position: "center", shadow: true },
  right_side: { scale: 0.82, position: "center", shadow: true },
  custom: { scale: 0.85, position: "center", shadow: false },
};

export interface StudioSettings {
  canvasSize: number;
  scale: number;
  position: Position;
  xOffset?: number;
  yOffset?: number;
  background: string;
  shadow: boolean;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowBlur?: number;
}

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
 *
 * Accepts either the legacy ProcessingSettings (background/position/padding)
 * or the v2 StudioSettings (canvasSize/scale/position/xOffset/yOffset/...) —
 * kept as one overloaded entry point so existing callers don't need to change.
 */
export async function composeStudioImage(
  cleanedBuffer: Buffer,
  settings?: ProcessingSettings
): Promise<Buffer>;
export async function composeStudioImage(
  cleanedBuffer: Buffer,
  settings: StudioSettings
): Promise<Buffer>;
export async function composeStudioImage(
  cleanedBuffer: Buffer,
  settings: ProcessingSettings | StudioSettings = DEFAULT_SETTINGS
): Promise<Buffer> {
  const studioSettings = isStudioSettings(settings) ? settings : toStudioSettings(settings);
  return renderStudioImage(cleanedBuffer, studioSettings);
}

function isStudioSettings(settings: ProcessingSettings | StudioSettings): settings is StudioSettings {
  return "scale" in settings;
}

// Legacy padding->scale mapping so ProcessingSettings callers get the same
// framing as before: scale = 1 - 2*paddingRatio, matching the old
// maxProductSize math exactly.
function toStudioSettings(settings: ProcessingSettings): StudioSettings {
  return {
    canvasSize: MASTER_SIZE,
    scale: 1 - 2 * PADDING_RATIOS[settings.padding],
    position: settings.position,
    background: settings.background,
    shadow: settings.shadow,
  };
}

// 1. Trim transparent empty space (real bounding box, never PhotoRoom's raw
//    output dimensions) -> 2. resize to `scale` occupancy of the canvas ->
//    3. calculate exact composite coordinates -> 4. optional soft shadow ->
//    5. shadow composited first, product second -> 6. flatten onto white
//    (unless transparent requested) -> 7. export WebP q92.
async function renderStudioImage(cleanedBuffer: Buffer, settings: StudioSettings): Promise<Buffer> {
  const canvasSize = settings.canvasSize || MASTER_SIZE;

  let productBuffer = cleanedBuffer;
  try {
    productBuffer = await sharp(cleanedBuffer).trim().toBuffer();
  } catch {
    // Edges weren't uniform enough to trim (e.g. already tight crop) — use
    // the untrimmed cutout, composition below still centers it correctly.
  }

  // scale is the trimmed product's max occupancy of the canvas, e.g. 0.88 on
  // a 2000px canvas -> fit inside 1760x1760, aspect ratio preserved.
  const targetSize = Math.round(canvasSize * settings.scale);
  const resizedProduct = await sharp(productBuffer)
    .resize({ width: targetSize, height: targetSize, fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resizedProduct).metadata();
  const productWidth = resizedMeta.width ?? targetSize;
  const productHeight = resizedMeta.height ?? targetSize;

  const anchor = POSITION_ANCHORS[settings.position];
  const left = Math.round(anchor.x * (canvasSize - productWidth)) + (settings.xOffset ?? 0);
  const top = Math.round(anchor.y * (canvasSize - productHeight)) + (settings.yOffset ?? 0);

  const compositeLayers: { input: Buffer; left: number; top: number }[] = [];
  if (settings.shadow) {
    // Soft drop shadow: blur the product's own alpha silhouette, fade it
    // to ~35% opacity, offset it down a few px, composite underneath.
    const shadowOffsetX = settings.shadowOffsetX ?? 0;
    const shadowOffsetY = settings.shadowOffsetY ?? Math.round(canvasSize * 0.015);
    const shadowBlur = settings.shadowBlur ?? Math.round(canvasSize * 0.02);
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
    compositeLayers.push({ input: shadowLayer, left: left + shadowOffsetX, top: top + shadowOffsetY });
  }
  compositeLayers.push({ input: resizedProduct, left, top });

  let masterPipeline = sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(compositeLayers);
  if (settings.background !== "transparent") {
    masterPipeline = masterPipeline.flatten({ background: settings.background || "#ffffff" });
  }
  return masterPipeline.webp({ quality: 92 }).toBuffer();
}

export interface ProcessProductImageOptions {
  input: Buffer;
  mimeType: string;
  viewType?: ProductViewType;
  settings?: Partial<ViewPreset>;
}

export interface ProcessProductImageResult {
  buffer: Buffer;
  width: number;
  height: number;
  viewType: ProductViewType;
  appliedScale: number;
  appliedPosition: Position;
}

/**
 * Full pipeline: PhotoRoom background removal -> trim -> view-preset-driven
 * studio composite. Accepts either the legacy (buffer, mimeType) call or the
 * v2 options object ({ input, mimeType, viewType, settings }); manual
 * `settings` fields override the resolved VIEW_PRESETS entry.
 */
export async function processProductImage(inputBuffer: Buffer, mimeType: string): Promise<Buffer>;
export async function processProductImage(options: ProcessProductImageOptions): Promise<ProcessProductImageResult>;
export async function processProductImage(
  inputOrOptions: Buffer | ProcessProductImageOptions,
  mimeType?: string
): Promise<Buffer | ProcessProductImageResult> {
  if (Buffer.isBuffer(inputOrOptions)) {
    // Legacy call shape: same behavior as before (DEFAULT_SETTINGS, "custom"
    // framing), returns a bare buffer.
    const cutout = await removeBackground(inputOrOptions, mimeType!);
    const cleaned = await sharp(cutout).normalize().sharpen({ sigma: 0.5 }).toBuffer();
    return composeStudioImage(cleaned, DEFAULT_SETTINGS);
  }

  const { input, mimeType: mt, viewType = "custom", settings } = inputOrOptions;
  const preset = VIEW_PRESETS[viewType] ?? VIEW_PRESETS.custom;
  const merged: ViewPreset = { ...preset, ...settings };

  const cutout = await removeBackground(input, mt);
  const cleaned = await sharp(cutout).normalize().sharpen({ sigma: 0.5 }).toBuffer();

  const studioSettings: StudioSettings = {
    canvasSize: MASTER_SIZE,
    scale: merged.scale,
    position: merged.position,
    xOffset: merged.xOffset,
    yOffset: merged.yOffset,
    background: "#ffffff",
    shadow: merged.shadow,
    shadowOffsetX: merged.shadowOffsetX,
    shadowOffsetY: merged.shadowOffsetY,
    shadowBlur: merged.shadowBlur,
  };
  const buffer = await renderStudioImage(cleaned, studioSettings);

  return {
    buffer,
    width: MASTER_SIZE,
    height: MASTER_SIZE,
    viewType,
    appliedScale: merged.scale,
    appliedPosition: merged.position,
  };
}
