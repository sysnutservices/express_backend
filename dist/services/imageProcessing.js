"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROCESSING_CONFIG_VERSION = exports.VIEW_PRESETS = exports.DEFAULT_ENHANCEMENT = exports.DEFAULT_SETTINGS = void 0;
exports.removeBackground = removeBackground;
exports.composeStudioImage = composeStudioImage;
exports.computeTargetSize = computeTargetSize;
exports.computePosition = computePosition;
exports.flattenMasterToWhite = flattenMasterToWhite;
exports.computeOccupancy = computeOccupancy;
exports.analyzeExposure = analyzeExposure;
exports.analyzeReflection = analyzeReflection;
exports.generateVariants = generateVariants;
exports.validateMasterImage = validateMasterImage;
exports.resolveViewSettings = resolveViewSettings;
exports.viewPresetToStudioSettings = viewPresetToStudioSettings;
exports.processProductImage = processProductImage;
const sharp_1 = __importDefault(require("sharp"));
exports.DEFAULT_SETTINGS = {
    background: "white",
    position: "center",
    padding: "standard",
    shadow: false,
};
const MASTER_SIZE = 2000;
const PADDING_RATIOS = {
    compact: 0.04,
    standard: 0.08,
    spacious: 0.14,
};
const POSITION_ANCHORS = {
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
// Layer 1 of the 3-way merge (DEFAULT -> VIEW_PRESET -> MANUAL). Every view
// preset omits these, so they always come from here unless a caller overrides
// them explicitly — keeps enhancement conservative by default everywhere.
exports.DEFAULT_ENHANCEMENT = {
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
exports.VIEW_PRESETS = {
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
/**
 * Removes the background via the PhotoRoom Remove Background API, returning
 * a PNG buffer with alpha transparency. Isolated behind this one function so
 * swapping providers later doesn't touch the rest of the pipeline.
 * https://www.photoroom.com/api/docs/remove-background
 */
function removeBackground(inputBuffer, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        const apiKey = process.env.PHOTOROOM_API_KEY;
        if (!apiKey)
            throw new Error("PHOTOROOM_API_KEY is not set");
        // Sandbox mode doesn't consume paid credits — flip on in dev/test via env
        // so iterating on this doesn't burn the real quota.
        const keyHeader = process.env.PHOTOROOM_SANDBOX === "true" ? `sandbox_${apiKey}` : apiKey;
        const form = new FormData();
        form.append("image_file", new Blob([new Uint8Array(inputBuffer)], { type: mimeType }), "source");
        const res = yield fetch("https://sdk.photoroom.com/v1/segment", {
            method: "POST",
            headers: { "x-api-key": keyHeader },
            body: form,
        });
        if (!res.ok) {
            const text = yield res.text().catch(() => "");
            throw new Error(`Background removal failed (${res.status}): ${text.slice(0, 200)}`);
        }
        return Buffer.from(yield res.arrayBuffer());
    });
}
function composeStudioImage(cleanedBuffer_1) {
    return __awaiter(this, arguments, void 0, function* (cleanedBuffer, settings = exports.DEFAULT_SETTINGS) {
        const studioSettings = isStudioSettings(settings) ? settings : toStudioSettings(settings);
        return renderStudioImage(cleanedBuffer, studioSettings);
    });
}
function isStudioSettings(settings) {
    return "scale" in settings;
}
// Legacy padding->scale mapping so ProcessingSettings callers get the same
// framing as before: scale = 1 - 2*paddingRatio, matching the old
// maxProductSize math exactly.
function toStudioSettings(settings) {
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
function computeTargetSize(canvasSize, scale) {
    return Math.round(canvasSize * scale);
}
// Exact x/y compositing coordinates for a given anchor + offsets, clamped so
// the product can never be pushed outside the canvas by an extreme offset.
function computePosition(canvasWidth, canvasHeight, productWidth, productHeight, position, xOffset = 0, yOffset = 0) {
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
function applyEnhancement(buffer, settings) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        let img = (0, sharp_1.default)(buffer);
        const brightness = (_a = settings.brightness) !== null && _a !== void 0 ? _a : 1;
        const saturation = (_b = settings.saturation) !== null && _b !== void 0 ? _b : 1;
        if (brightness !== 1 || saturation !== 1) {
            img = img.modulate({ brightness, saturation });
        }
        const contrast = (_c = settings.contrast) !== null && _c !== void 0 ? _c : 1;
        if (contrast !== 1) {
            img = img.linear(contrast, 128 * (1 - contrast));
        }
        if (settings.sharpen !== false) {
            img = img.sharpen({ sigma: 0.5 });
        }
        return img.toBuffer();
    });
}
// 1. Trim transparent empty space (real bounding box, never PhotoRoom's raw
//    output dimensions) -> 2. conservative enhancement -> 3. resize to
//    `scale` occupancy of the canvas -> 4. calculate exact composite
//    coordinates -> 5. optional soft shadow -> 6. shadow composited first,
//    product second -> 7. flatten onto white (unless transparent requested)
//    -> 8. export in the requested format.
function renderStudioImage(cleanedBuffer, settings) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
            productBuffer = yield (0, sharp_1.default)(cleanedBuffer).trim({ threshold: 15 }).toBuffer();
        }
        catch (_k) {
            // Edges weren't uniform enough to trim (e.g. already tight crop) — use
            // the untrimmed cutout, composition below still centers it correctly.
        }
        productBuffer = yield applyEnhancement(productBuffer, settings);
        const targetSize = computeTargetSize(canvasSize, settings.scale);
        const resizedProduct = yield (0, sharp_1.default)(productBuffer)
            .resize({ width: targetSize, height: targetSize, fit: "inside", withoutEnlargement: false })
            .toBuffer();
        const resizedMeta = yield (0, sharp_1.default)(resizedProduct).metadata();
        const productWidth = (_a = resizedMeta.width) !== null && _a !== void 0 ? _a : targetSize;
        const productHeight = (_b = resizedMeta.height) !== null && _b !== void 0 ? _b : targetSize;
        const { left, top } = computePosition(canvasSize, canvasSize, productWidth, productHeight, settings.position, (_c = settings.xOffset) !== null && _c !== void 0 ? _c : 0, (_d = settings.yOffset) !== null && _d !== void 0 ? _d : 0);
        const compositeLayers = [];
        if (settings.shadow) {
            // Soft drop shadow: blur the product's own alpha silhouette, fade it
            // to ~35% opacity, offset it down a few px, composite underneath.
            const shadowOffsetX = (_e = settings.shadowOffsetX) !== null && _e !== void 0 ? _e : 0;
            const shadowOffsetY = (_f = settings.shadowOffsetY) !== null && _f !== void 0 ? _f : Math.round(canvasSize * 0.015);
            const shadowBlur = (_g = settings.shadowBlur) !== null && _g !== void 0 ? _g : Math.round(canvasSize * 0.02);
            const shadowAlpha = yield (0, sharp_1.default)(resizedProduct)
                .ensureAlpha()
                .extractChannel(3)
                .linear((_h = settings.shadowOpacity) !== null && _h !== void 0 ? _h : 0.25, 0)
                .blur(shadowBlur)
                .toBuffer();
            const shadowLayer = yield (0, sharp_1.default)({
                create: { width: productWidth, height: productHeight, channels: 3, background: "#000000" },
            })
                .joinChannel(shadowAlpha)
                .png()
                .toBuffer();
            compositeLayers.push({ input: shadowLayer, left: left + shadowOffsetX, top: top + shadowOffsetY });
        }
        compositeLayers.push({ input: resizedProduct, left, top });
        let masterPipeline = (0, sharp_1.default)({
            create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).composite(compositeLayers);
        if (settings.background !== "transparent") {
            masterPipeline = masterPipeline.flatten({ background: settings.background || "#ffffff" });
        }
        const quality = (_j = settings.quality) !== null && _j !== void 0 ? _j : 92;
        switch (settings.outputFormat) {
            case "jpeg":
                return masterPipeline.jpeg({ quality }).toBuffer();
            case "png":
                return masterPipeline.png().toBuffer();
            default:
                return masterPipeline.webp({ quality }).toBuffer();
        }
    });
}
const VARIANT_SIZES = { product: 1200, thumbnail: 500 };
// Versions the *composition* config (VIEW_PRESETS/DEFAULT_ENHANCEMENT/sizes).
// Feeds the processing fingerprint in imageCostControl.ts — bump this only
// when a change here should invalidate cached/approved results. v2: dropped
// auto-normalize, retuned occupancy/shadow. v3: auto exposure/reflection
// analysis (see analyzeExposure/analyzeReflection).
exports.PROCESSING_CONFIG_VERSION = "v3";
// Derives the opaque white-background ecommerce version from an already-
// composed transparent master — a flatten + format convert, not a
// re-composite, so the two versions stay pixel-identical everywhere but the
// background (the white one is never a second, independently-generated
// image).
function flattenMasterToWhite(transparentMasterBuffer_1) {
    return __awaiter(this, arguments, void 0, function* (transparentMasterBuffer, outputFormat = "webp", quality = 92) {
        const img = (0, sharp_1.default)(transparentMasterBuffer).flatten({ background: "#ffffff" });
        switch (outputFormat) {
            case "jpeg":
                return img.jpeg({ quality }).toBuffer();
            case "png":
                return img.png().toBuffer();
            default:
                return img.webp({ quality }).toBuffer();
        }
    });
}
// How much of the canvas the product actually occupies, for the admin
// preview's "Product occupancy: XX%" readout — display only, not a pass/fail
// check (see validateMasterImage for that). Assumes a white-background
// master, same as validateMasterImage's own occupancy check.
function computeOccupancy(masterBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const meta = yield (0, sharp_1.default)(masterBuffer).metadata();
        const canvasSize = meta.width || MASTER_SIZE;
        try {
            const trimmed = yield (0, sharp_1.default)(masterBuffer).trim({ background: "#ffffff", threshold: 10 }).toBuffer({ resolveWithObject: true });
            return Math.round((Math.max(trimmed.info.width, trimmed.info.height) / canvasSize) * 100);
        }
        catch (_a) {
            return 0;
        }
    });
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
function analyzeExposure(cutoutBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const stats = yield (0, sharp_1.default)(cutoutBuffer).stats();
        const rgb = stats.channels.slice(0, 3);
        const meanLuminance = rgb.reduce((sum, c) => sum + c.mean, 0) / rgb.length;
        const meanStdev = rgb.reduce((sum, c) => sum + c.stdev, 0) / rgb.length;
        let brightness = 1;
        if (meanLuminance < HEALTHY_MEAN_LOW) {
            const deficit = (HEALTHY_MEAN_LOW - meanLuminance) / HEALTHY_MEAN_LOW;
            brightness = 1 + Math.min(BRIGHTNESS_MAX_ADJUST, deficit * BRIGHTNESS_MAX_ADJUST * 2);
        }
        else if (meanLuminance > HEALTHY_MEAN_HIGH) {
            const excess = (meanLuminance - HEALTHY_MEAN_HIGH) / (255 - HEALTHY_MEAN_HIGH);
            brightness = 1 - Math.min(BRIGHTNESS_MAX_ADJUST, excess * BRIGHTNESS_MAX_ADJUST * 2);
        }
        let contrast = 1;
        if (meanStdev < HEALTHY_STDEV_MIN) {
            const deficit = (HEALTHY_STDEV_MIN - meanStdev) / HEALTHY_STDEV_MIN;
            contrast = 1 + Math.min(CONTRAST_MAX_ADJUST, deficit * CONTRAST_MAX_ADJUST * 2);
        }
        return { brightness, contrast, needsCorrection: brightness !== 1 || contrast !== 1 };
    });
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
function analyzeReflection(cutoutBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data, info } = yield (0, sharp_1.default)(cutoutBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const channels = info.channels;
        let productPixels = 0;
        let hotspotPixels = 0;
        let brightnessSum = 0;
        for (let i = 0; i < data.length; i += channels) {
            if (data[i + 3] < 200)
                continue; // outside the product silhouette
            const r = data[i], g = data[i + 1], b = data[i + 2];
            productPixels++;
            brightnessSum += (r + g + b) / 3;
            if (r > HOTSPOT_CHANNEL_THRESHOLD && g > HOTSPOT_CHANNEL_THRESHOLD && b > HOTSPOT_CHANNEL_THRESHOLD)
                hotspotPixels++;
        }
        if (productPixels === 0)
            return { detected: false, hotspotPercent: 0 };
        const hotspotPercent = Math.round((hotspotPixels / productPixels) * 1000) / 10;
        const meanBrightness = brightnessSum / productPixels;
        const detected = hotspotPercent >= HOTSPOT_MIN_PERCENT &&
            hotspotPercent <= HOTSPOT_MAX_PERCENT &&
            meanBrightness < NATURALLY_BRIGHT_PRODUCT_MEAN;
        return { detected, hotspotPercent };
    });
}
// Downscales the already-composited master into the catalogue's other two
// sizes. No second PhotoRoom call and no re-compositing — same master pixels,
// just resized, so all three sizes stay visually identical.
function generateVariants(masterBuffer_1) {
    return __awaiter(this, arguments, void 0, function* (masterBuffer, masterSize = MASTER_SIZE) {
        const [product, thumbnail] = yield Promise.all(Object.values(VARIANT_SIZES).map((size) => (0, sharp_1.default)(masterBuffer).resize(size, size).webp({ quality: 90 }).toBuffer()));
        return {
            master: { buffer: masterBuffer, width: masterSize, height: masterSize },
            product: { buffer: product, width: VARIANT_SIZES.product, height: VARIANT_SIZES.product },
            thumbnail: { buffer: thumbnail, width: VARIANT_SIZES.thumbnail, height: VARIANT_SIZES.thumbnail },
        };
    });
}
// Lightweight, deterministic sanity checks on a composed master — catches
// gross pipeline failures (wrong dimensions, near-empty or edge-to-edge
// product, a flatten that didn't actually produce white) so a version can
// be flagged for closer manual review instead of silently reaching
// READY_FOR_REVIEW looking obviously broken. Never blocks approval by
// itself — informational only (see ProductImage.qualityWarning). This is
// NOT a perceptual/similarity check against the original (out of scope for
// this pass) — it only catches "did composition itself go wrong."
function validateMasterImage(masterBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const meta = yield (0, sharp_1.default)(masterBuffer).metadata();
        if (meta.width !== MASTER_SIZE || meta.height !== MASTER_SIZE) {
            return `Unexpected master dimensions: ${meta.width}x${meta.height} (expected ${MASTER_SIZE}x${MASTER_SIZE})`;
        }
        // Checked before occupancy: the occupancy trim below assumes a white
        // background to trim against, so a wrong background color would make
        // that check unreliable too — catch the more specific problem first.
        const corners = yield Promise.all([
            { left: 2, top: 2 },
            { left: MASTER_SIZE - 3, top: 2 },
            { left: 2, top: MASTER_SIZE - 3 },
            { left: MASTER_SIZE - 3, top: MASTER_SIZE - 3 },
        ].map((pos) => (0, sharp_1.default)(masterBuffer).extract(Object.assign(Object.assign({}, pos), { width: 1, height: 1 })).raw().toBuffer()));
        const offWhite = corners.some((px) => px[0] < 250 || px[1] < 250 || px[2] < 250);
        if (offWhite) {
            return "Background corner is not clean white — check compositing";
        }
        let trimmed;
        try {
            trimmed = yield (0, sharp_1.default)(masterBuffer).trim({ background: "#ffffff", threshold: 10 }).toBuffer({ resolveWithObject: true });
        }
        catch (_a) {
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
    });
}
// 3-way merge, manual settings always win: DEFAULT_ENHANCEMENT -> VIEW_PRESET
// -> settings. Extracted out of processProductImage so
// productImageOrchestrator.ts's OpenAI-based pipeline can reuse the exact
// same resolution instead of duplicating it.
function resolveViewSettings(viewType, settings) {
    var _a;
    const preset = (_a = exports.VIEW_PRESETS[viewType]) !== null && _a !== void 0 ? _a : exports.VIEW_PRESETS.custom;
    const merged = Object.assign(Object.assign(Object.assign({}, exports.DEFAULT_ENHANCEMENT), preset), settings);
    // Global kill switch — only when the caller didn't already pass an
    // explicit shadow value of their own (e.g. the settings panel's live
    // preview toggle), matching how every other 3-way merge here works.
    if (process.env.ENABLE_SHADOW === "false" && (settings === null || settings === void 0 ? void 0 : settings.shadow) === undefined) {
        merged.shadow = false;
    }
    return merged;
}
// Maps a resolved ViewPreset onto the StudioSettings shape renderStudioImage
// expects — same mapping processProductImage's v2 branch always did inline.
function viewPresetToStudioSettings(merged, background = "#ffffff") {
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
function processProductImage(inputOrOptions, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        if (Buffer.isBuffer(inputOrOptions)) {
            // Legacy call shape: same behavior as before (DEFAULT_SETTINGS, "custom"
            // framing), returns a bare buffer. renderStudioImage trims + enhances
            // internally, so no pre-processing needed here.
            const cutout = yield removeBackground(inputOrOptions, mimeType);
            return composeStudioImage(cutout, exports.DEFAULT_SETTINGS);
        }
        const { input, mimeType: mt, viewType = "custom", settings } = inputOrOptions;
        const merged = resolveViewSettings(viewType, settings);
        const cutout = yield removeBackground(input, mt);
        const studioSettings = viewPresetToStudioSettings(merged);
        const buffer = yield renderStudioImage(cutout, studioSettings);
        return {
            buffer,
            width: MASTER_SIZE,
            height: MASTER_SIZE,
            viewType,
            appliedScale: merged.scale,
            appliedPosition: merged.position,
            appliedSettings: merged,
        };
    });
}
