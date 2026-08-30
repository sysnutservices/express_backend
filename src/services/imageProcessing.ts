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
  | "open_angle"
  | "closed_top"
  | "closed_angle"
  | "closed_rear"
  | "bottom"
  | "left_side"
  | "right_side"
  | "ports"
  | "detail"
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
  shadowOpacity?: number;
  // Conservative source-photo enhancement, applied before compositing.
  // Multipliers (1 = no change), mirroring sharp's own modulate() scale.
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpen?: boolean;
  outputFormat?: "webp" | "jpeg" | "png";
  quality?: number;
}

// Layer 1 of the 3-way merge (DEFAULT -> VIEW_PRESET -> MANUAL). Every view
// preset omits these, so they always come from here unless a caller overrides
// them explicitly — keeps enhancement conservative by default everywhere.
export const DEFAULT_ENHANCEMENT: Pick<ViewPreset, "brightness" | "contrast" | "saturation" | "sharpen"> = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  sharpen: true,
};

// Explicit per-view occupancy/position/shadow instead of one fixed
// compact/standard/spacious padding for every angle. Tune freely per view —
// nothing else in the pipeline depends on these specific numbers. Target
// occupancy: open front 88-92%, side 82-88%, closed-lid/bottom 82-90% — these
// only set the SCALE the bbox-cropped product is resized to; how tight the
// bbox itself is comes from localSegmentation.ts's crop, not these numbers.
// Every view gets a subtle grounding shadow by default now (catalogue-style
// reference images all have one); ENABLE_SHADOW=false in resolveViewSettings
// below is the global kill switch if it's ever not wanted.
export const VIEW_PRESETS: Record<ProductViewType, ViewPreset> = {
  open_front: { scale: 0.90, position: "center-bottom", yOffset: -20, shadow: true },
  open_angle: { scale: 0.88, position: "center", shadow: true },
  closed_top: { scale: 0.86, position: "center", shadow: true },
  closed_angle: { scale: 0.86, position: "center", shadow: true },
  closed_rear: { scale: 0.86, position: "center", shadow: true, shadowOffsetY: 18 },
  bottom: { scale: 0.86, position: "center", shadow: true },
  left_side: { scale: 0.85, position: "center", shadow: true },
  right_side: { scale: 0.85, position: "center", shadow: true },
  ports: { scale: 0.86, position: "center", shadow: true },
  detail: { scale: 0.86, position: "center", shadow: true },
  custom: { scale: 0.86, position: "center", shadow: true },
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
  shadowOpacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sharpen?: boolean;
  outputFormat?: "webp" | "jpeg" | "png";
  quality?: number;
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

// scale is the trimmed product's max occupancy of the canvas, e.g. 0.88 on a
// 2000px canvas -> fit inside 1760x1760. Exported so scale math is testable
// without spinning up Sharp.
export function computeTargetSize(canvasSize: number, scale: number): number {
  return Math.round(canvasSize * scale);
}

// Exact x/y compositing coordinates for a given anchor + offsets, clamped so
// the product can never be pushed outside the canvas by an extreme offset.
export function computePosition(
  canvasWidth: number,
  canvasHeight: number,
  productWidth: number,
  productHeight: number,
  position: Position,
  xOffset = 0,
  yOffset = 0
): { left: number; top: number } {
  const anchor = POSITION_ANCHORS[position];
  const left = Math.round(anchor.x * (canvasWidth - productWidth)) + xOffset;
  const top = Math.round(anchor.y * (canvasHeight - productHeight)) + yOffset;
  return {
    left: Math.max(0, Math.min(left, Math.max(0, canvasWidth - productWidth))),
    top: Math.max(0, Math.min(top, Math.max(0, canvasHeight - productHeight))),
  };
}

// Conservative source-photo enhancement: optional brightness/saturation
// (sharp modulate), contrast (linear stretch around the midpoint), and mild
// sharpening — each a no-op unless a caller/preset actually sets it away
// from 1. Never touches hue or geometry, so it can't alter the physical
// product — only how the photo of it looks.
//
// Deliberately does NOT call sharp's normalize(): that stretches the
// histogram to fill the full dynamic range, which can visibly shift a
// silver chassis toward white or a black one toward grey — exactly the
// color-fidelity risk this pipeline exists to avoid. Auto-exposure isn't
// worth that risk; a manual brightness value stays available for a genuinely
// dark source photo.
async function applyEnhancement(buffer: Buffer, settings: StudioSettings): Promise<Buffer> {
  let img = sharp(buffer);

  const brightness = settings.brightness ?? 1;
  const saturation = settings.saturation ?? 1;
  if (brightness !== 1 || saturation !== 1) {
    img = img.modulate({ brightness, saturation });
  }

  const contrast = settings.contrast ?? 1;
  if (contrast !== 1) {
    img = img.linear(contrast, 128 * (1 - contrast));
  }

  if (settings.sharpen !== false) {
    img = img.sharpen({ sigma: 0.5 });
  }

  return img.toBuffer();
}

// 1. Trim transparent empty space (real bounding box, never PhotoRoom's raw
//    output dimensions) -> 2. conservative enhancement -> 3. resize to
//    `scale` occupancy of the canvas -> 4. calculate exact composite
//    coordinates -> 5. optional soft shadow -> 6. shadow composited first,
//    product second -> 7. flatten onto white (unless transparent requested)
//    -> 8. export in the requested format.
async function renderStudioImage(cleanedBuffer: Buffer, settings: StudioSettings): Promise<Buffer> {
  const canvasSize = settings.canvasSize || MASTER_SIZE;

  let productBuffer = cleanedBuffer;
  try {
    // No explicit `background` — sharp defaults to the top-left pixel's own
    // color, which is what makes this work for both cutout shapes this
    // function receives: a transparent (alpha=0) PhotoRoom cutout, and an
    // opaque near-white OpenAI edit. A wider threshold than sharp's default
    // (10) tolerates the mild vignette/gradient/JPEG noise real AI output
    // has near its edges without risking eating into product pixels — a
    // dark laptop chassis differs from white by ~200+, far above this.
    productBuffer = await sharp(cleanedBuffer).trim({ threshold: 15 }).toBuffer();
  } catch {
    // Edges weren't uniform enough to trim (e.g. already tight crop) — use
    // the untrimmed cutout, composition below still centers it correctly.
  }

  productBuffer = await applyEnhancement(productBuffer, settings);

  const targetSize = computeTargetSize(canvasSize, settings.scale);
  const resizedProduct = await sharp(productBuffer)
    .resize({ width: targetSize, height: targetSize, fit: "inside", withoutEnlargement: false })
    .toBuffer();
  const resizedMeta = await sharp(resizedProduct).metadata();
  const productWidth = resizedMeta.width ?? targetSize;
  const productHeight = resizedMeta.height ?? targetSize;

  const { left, top } = computePosition(
    canvasSize,
    canvasSize,
    productWidth,
    productHeight,
    settings.position,
    settings.xOffset ?? 0,
    settings.yOffset ?? 0
  );

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
      .linear(settings.shadowOpacity ?? 0.25, 0)
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

  const quality = settings.quality ?? 92;
  switch (settings.outputFormat) {
    case "jpeg":
      return masterPipeline.jpeg({ quality }).toBuffer();
    case "png":
      return masterPipeline.png().toBuffer();
    default:
      return masterPipeline.webp({ quality }).toBuffer();
  }
}

export interface ImageVariant {
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ProductImageVariants {
  master: ImageVariant;
  product: ImageVariant;
  thumbnail: ImageVariant;
}

const VARIANT_SIZES = { product: 1200, thumbnail: 500 } as const;

// Versions the *composition* config (VIEW_PRESETS/DEFAULT_ENHANCEMENT/sizes).
// Feeds the processing fingerprint in imageCostControl.ts — bump this only
// when a change here should invalidate cached/approved results. v2: dropped
// auto-normalize, retuned occupancy/shadow. v3: auto exposure/reflection
// analysis (see analyzeExposure/analyzeReflection).
export const PROCESSING_CONFIG_VERSION = "v3";

// Derives the opaque white-background ecommerce version from an already-
// composed transparent master — a flatten + format convert, not a
// re-composite, so the two versions stay pixel-identical everywhere but the
// background (the white one is never a second, independently-generated
// image).
export async function flattenMasterToWhite(
  transparentMasterBuffer: Buffer,
  outputFormat: StudioSettings["outputFormat"] = "webp",
  quality = 92
): Promise<Buffer> {
  const img = sharp(transparentMasterBuffer).flatten({ background: "#ffffff" });
  switch (outputFormat) {
    case "jpeg":
      return img.jpeg({ quality }).toBuffer();
    case "png":
      return img.png().toBuffer();
    default:
      return img.webp({ quality }).toBuffer();
  }
}

// How much of the canvas the product actually occupies, for the admin
// preview's "Product occupancy: XX%" readout — display only, not a pass/fail
// check (see validateMasterImage for that). Assumes a white-background
// master, same as validateMasterImage's own occupancy check.
export async function computeOccupancy(masterBuffer: Buffer): Promise<number> {
  const meta = await sharp(masterBuffer).metadata();
  const canvasSize = meta.width || MASTER_SIZE;
  try {
    const trimmed = await sharp(masterBuffer).trim({ background: "#ffffff", threshold: 10 }).toBuffer({ resolveWithObject: true });
    return Math.round((Math.max(trimmed.info.width, trimmed.info.height) / canvasSize) * 100);
  } catch {
    return 0;
  }
}

export interface ExposureAnalysis {
  brightness: number; // multiplier for applyEnhancement, 1 = no change
  contrast: number; // multiplier for applyEnhancement, 1 = no change
  needsCorrection: boolean;
}

// Conservative bounds, not a general-purpose auto-levels tool: nudges a
// photo toward a healthy exposure band, never a large correction. Analyzed
// on the SEGMENTED CUTOUT, not the raw original with its background still
// attached — a plain white studio backdrop would otherwise dominate the
// histogram and make every photo read as "overexposed" regardless of how
// the product itself actually looks.
const BRIGHTNESS_MAX_ADJUST = 0.08; // ±8%
const CONTRAST_MAX_ADJUST = 0.05; // +5% (only ever brightens a flat/hazy image, never reduces contrast)
const HEALTHY_MEAN_LOW = 90;
const HEALTHY_MEAN_HIGH = 170;
const HEALTHY_STDEV_MIN = 35;

export async function analyzeExposure(cutoutBuffer: Buffer): Promise<ExposureAnalysis> {
  const stats = await sharp(cutoutBuffer).stats();
  const rgb = stats.channels.slice(0, 3);
  const meanLuminance = rgb.reduce((sum, c) => sum + c.mean, 0) / rgb.length;
  const meanStdev = rgb.reduce((sum, c) => sum + c.stdev, 0) / rgb.length;

  let brightness = 1;
  if (meanLuminance < HEALTHY_MEAN_LOW) {
    const deficit = (HEALTHY_MEAN_LOW - meanLuminance) / HEALTHY_MEAN_LOW;
    brightness = 1 + Math.min(BRIGHTNESS_MAX_ADJUST, deficit * BRIGHTNESS_MAX_ADJUST * 2);
  } else if (meanLuminance > HEALTHY_MEAN_HIGH) {
    const excess = (meanLuminance - HEALTHY_MEAN_HIGH) / (255 - HEALTHY_MEAN_HIGH);
    brightness = 1 - Math.min(BRIGHTNESS_MAX_ADJUST, excess * BRIGHTNESS_MAX_ADJUST * 2);
  }

  let contrast = 1;
  if (meanStdev < HEALTHY_STDEV_MIN) {
    const deficit = (HEALTHY_STDEV_MIN - meanStdev) / HEALTHY_STDEV_MIN;
    contrast = 1 + Math.min(CONTRAST_MAX_ADJUST, deficit * CONTRAST_MAX_ADJUST * 2);
  }

  return { brightness, contrast, needsCorrection: brightness !== 1 || contrast !== 1 };
}

export interface ReflectionAnalysis {
  detected: boolean;
  hotspotPercent: number;
}

// Looks for a small, near-blown-out ("hotspot") region inside the product
// silhouette — a light-glare signature — without flagging a laptop that's
// just naturally silver/white overall (that would cover most of the
// product, not a small fraction of it). Deliberately does NOT attempt to
// locate or remove the reflection itself here — a safe, general-purpose
// deterministic reflection-removal algorithm is a real computer-vision
// problem, not a few lines of Sharp; this only decides whether one is
// probably present, for the "Auto" mode's review flag and the "On" mode's
// decision to spend an OpenAI call on it at all.
const HOTSPOT_CHANNEL_THRESHOLD = 250;
const HOTSPOT_MIN_PERCENT = 1.5;
const HOTSPOT_MAX_PERCENT = 20;
const NATURALLY_BRIGHT_PRODUCT_MEAN = 230;

export async function analyzeReflection(cutoutBuffer: Buffer): Promise<ReflectionAnalysis> {
  const { data, info } = await sharp(cutoutBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let productPixels = 0;
  let hotspotPixels = 0;
  let brightnessSum = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (data[i + 3] < 200) continue; // outside the product silhouette
    const r = data[i], g = data[i + 1], b = data[i + 2];
    productPixels++;
    brightnessSum += (r + g + b) / 3;
    if (r > HOTSPOT_CHANNEL_THRESHOLD && g > HOTSPOT_CHANNEL_THRESHOLD && b > HOTSPOT_CHANNEL_THRESHOLD) hotspotPixels++;
  }
  if (productPixels === 0) return { detected: false, hotspotPercent: 0 };

  const hotspotPercent = Math.round((hotspotPixels / productPixels) * 1000) / 10;
  const meanBrightness = brightnessSum / productPixels;
  const detected =
    hotspotPercent >= HOTSPOT_MIN_PERCENT &&
    hotspotPercent <= HOTSPOT_MAX_PERCENT &&
    meanBrightness < NATURALLY_BRIGHT_PRODUCT_MEAN;
  return { detected, hotspotPercent };
}

// Coarse perceptual-difference proxy for "how much did this edit change the
// product region" — resizes both to a small fixed size (so a resolution or
// crop-boundary difference between the two doesn't itself register as
// change) and averages per-pixel colour distance. Used to flag a reflection
// edit that touched more than the glare it was asked to touch, never to
// judge product-preservation with pixel-perfect precision.
const REGION_DIFF_SIZE = 128;

export async function computeRegionChangePercent(beforeBuffer: Buffer, afterBuffer: Buffer): Promise<number> {
  const [before, after] = await Promise.all(
    [beforeBuffer, afterBuffer].map((buf) =>
      sharp(buf).resize(REGION_DIFF_SIZE, REGION_DIFF_SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer()
    )
  );
  const pixelCount = REGION_DIFF_SIZE * REGION_DIFF_SIZE;
  let changed = 0;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 3;
    const dr = before[o] - after[o];
    const dg = before[o + 1] - after[o + 1];
    const db = before[o + 2] - after[o + 2];
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance > 30) changed++; // ~10% of the max possible 0..441 distance
  }
  return Math.round((changed / pixelCount) * 1000) / 10;
}

// Downscales the already-composited master into the catalogue's other two
// sizes. No second PhotoRoom call and no re-compositing — same master pixels,
// just resized, so all three sizes stay visually identical.
export async function generateVariants(masterBuffer: Buffer, masterSize = MASTER_SIZE): Promise<ProductImageVariants> {
  const [product, thumbnail] = await Promise.all(
    (Object.values(VARIANT_SIZES) as number[]).map((size) =>
      sharp(masterBuffer).resize(size, size).webp({ quality: 90 }).toBuffer()
    )
  );
  return {
    master: { buffer: masterBuffer, width: masterSize, height: masterSize },
    product: { buffer: product, width: VARIANT_SIZES.product, height: VARIANT_SIZES.product },
    thumbnail: { buffer: thumbnail, width: VARIANT_SIZES.thumbnail, height: VARIANT_SIZES.thumbnail },
  };
}

// Lightweight, deterministic sanity checks on a composed master — catches
// gross pipeline failures (wrong dimensions, near-empty or edge-to-edge
// product, a flatten that didn't actually produce white) so a version can
// be flagged for closer manual review instead of silently reaching
// READY_FOR_REVIEW looking obviously broken. Never blocks approval by
// itself — informational only (see ProductImage.qualityWarning). This is
// NOT a perceptual/similarity check against the original (out of scope for
// this pass) — it only catches "did composition itself go wrong."
export async function validateMasterImage(masterBuffer: Buffer): Promise<string | null> {
  const meta = await sharp(masterBuffer).metadata();
  if (meta.width !== MASTER_SIZE || meta.height !== MASTER_SIZE) {
    return `Unexpected master dimensions: ${meta.width}x${meta.height} (expected ${MASTER_SIZE}x${MASTER_SIZE})`;
  }

  // Checked before occupancy: the occupancy trim below assumes a white
  // background to trim against, so a wrong background color would make
  // that check unreliable too — catch the more specific problem first.
  const corners = await Promise.all(
    [
      { left: 2, top: 2 },
      { left: MASTER_SIZE - 3, top: 2 },
      { left: 2, top: MASTER_SIZE - 3 },
      { left: MASTER_SIZE - 3, top: MASTER_SIZE - 3 },
    ].map((pos) => sharp(masterBuffer).extract({ ...pos, width: 1, height: 1 }).raw().toBuffer())
  );
  const offWhite = corners.some((px) => px[0] < 250 || px[1] < 250 || px[2] < 250);
  if (offWhite) {
    return "Background corner is not clean white — check compositing";
  }

  let trimmed;
  try {
    trimmed = await sharp(masterBuffer).trim({ background: "#ffffff", threshold: 10 }).toBuffer({ resolveWithObject: true });
  } catch {
    return "Could not detect a product region in the composed image";
  }
  const occW = trimmed.info.width / MASTER_SIZE;
  const occH = trimmed.info.height / MASTER_SIZE;
  if (occW < 0.4 && occH < 0.4) {
    return `Product occupies only ~${Math.round(Math.max(occW, occH) * 100)}% of the frame — check for excessive whitespace`;
  }
  if (occW > 0.99 || occH > 0.99) {
    return "Product touches the canvas edge — check for cropping";
  }

  return null;
}

// 3-way merge, manual settings always win: DEFAULT_ENHANCEMENT -> VIEW_PRESET
// -> settings. Extracted out of processProductImage so
// productImageOrchestrator.ts's OpenAI-based pipeline can reuse the exact
// same resolution instead of duplicating it.
export function resolveViewSettings(viewType: ProductViewType, settings?: Partial<ViewPreset>): ViewPreset {
  const preset = VIEW_PRESETS[viewType] ?? VIEW_PRESETS.custom;
  const merged = { ...DEFAULT_ENHANCEMENT, ...preset, ...settings };
  // Global kill switch — only when the caller didn't already pass an
  // explicit shadow value of their own (e.g. the settings panel's live
  // preview toggle), matching how every other 3-way merge here works.
  if (process.env.ENABLE_SHADOW === "false" && settings?.shadow === undefined) {
    merged.shadow = false;
  }
  return merged;
}

// Maps a resolved ViewPreset onto the StudioSettings shape renderStudioImage
// expects — same mapping processProductImage's v2 branch always did inline.
export function viewPresetToStudioSettings(merged: ViewPreset, background: string = "#ffffff"): StudioSettings {
  return {
    canvasSize: MASTER_SIZE,
    scale: merged.scale,
    position: merged.position,
    xOffset: merged.xOffset,
    yOffset: merged.yOffset,
    background,
    shadow: merged.shadow,
    shadowOffsetX: merged.shadowOffsetX,
    shadowOffsetY: merged.shadowOffsetY,
    shadowBlur: merged.shadowBlur,
    shadowOpacity: merged.shadowOpacity,
    brightness: merged.brightness,
    contrast: merged.contrast,
    saturation: merged.saturation,
    sharpen: merged.sharpen,
    outputFormat: merged.outputFormat,
    quality: merged.quality,
  };
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
  appliedSettings: ViewPreset;
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
    // framing), returns a bare buffer. renderStudioImage trims + enhances
    // internally, so no pre-processing needed here.
    const cutout = await removeBackground(inputOrOptions, mimeType!);
    return composeStudioImage(cutout, DEFAULT_SETTINGS);
  }

  const { input, mimeType: mt, viewType = "custom", settings } = inputOrOptions;
  const merged: ViewPreset = resolveViewSettings(viewType, settings);

  const cutout = await removeBackground(input, mt);

  const studioSettings = viewPresetToStudioSettings(merged);
  const buffer = await renderStudioImage(cutout, studioSettings);

  return {
    buffer,
    width: MASTER_SIZE,
    height: MASTER_SIZE,
    viewType,
    appliedScale: merged.scale,
    appliedPosition: merged.position,
    appliedSettings: merged,
  };
}
