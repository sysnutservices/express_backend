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
exports.VIEW_PRESETS = exports.DEFAULT_SETTINGS = void 0;
exports.removeBackground = removeBackground;
exports.composeStudioImage = composeStudioImage;
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
// Explicit per-view occupancy/position/shadow instead of one fixed
// compact/standard/spacious padding for every angle. Tune freely per view —
// nothing else in the pipeline depends on these specific numbers.
exports.VIEW_PRESETS = {
    open_front: { scale: 0.88, position: "center-bottom", shadow: true, shadowOffsetY: 24 },
    closed_top: { scale: 0.86, position: "center", shadow: false },
    closed_rear: { scale: 0.84, position: "center", shadow: true, shadowOffsetY: 18 },
    bottom: { scale: 0.86, position: "center", shadow: false },
    left_side: { scale: 0.82, position: "center", shadow: true },
    right_side: { scale: 0.82, position: "center", shadow: true },
    custom: { scale: 0.85, position: "center", shadow: false },
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
// 1. Trim transparent empty space (real bounding box, never PhotoRoom's raw
//    output dimensions) -> 2. resize to `scale` occupancy of the canvas ->
//    3. calculate exact composite coordinates -> 4. optional soft shadow ->
//    5. shadow composited first, product second -> 6. flatten onto white
//    (unless transparent requested) -> 7. export WebP q92.
function renderStudioImage(cleanedBuffer, settings) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const canvasSize = settings.canvasSize || MASTER_SIZE;
        let productBuffer = cleanedBuffer;
        try {
            productBuffer = yield (0, sharp_1.default)(cleanedBuffer).trim().toBuffer();
        }
        catch (_h) {
            // Edges weren't uniform enough to trim (e.g. already tight crop) — use
            // the untrimmed cutout, composition below still centers it correctly.
        }
        // scale is the trimmed product's max occupancy of the canvas, e.g. 0.88 on
        // a 2000px canvas -> fit inside 1760x1760, aspect ratio preserved.
        const targetSize = Math.round(canvasSize * settings.scale);
        const resizedProduct = yield (0, sharp_1.default)(productBuffer)
            .resize({ width: targetSize, height: targetSize, fit: "inside", withoutEnlargement: false })
            .toBuffer();
        const resizedMeta = yield (0, sharp_1.default)(resizedProduct).metadata();
        const productWidth = (_a = resizedMeta.width) !== null && _a !== void 0 ? _a : targetSize;
        const productHeight = (_b = resizedMeta.height) !== null && _b !== void 0 ? _b : targetSize;
        const anchor = POSITION_ANCHORS[settings.position];
        const left = Math.round(anchor.x * (canvasSize - productWidth)) + ((_c = settings.xOffset) !== null && _c !== void 0 ? _c : 0);
        const top = Math.round(anchor.y * (canvasSize - productHeight)) + ((_d = settings.yOffset) !== null && _d !== void 0 ? _d : 0);
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
                .linear(0.35, 0)
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
        return masterPipeline.webp({ quality: 92 }).toBuffer();
    });
}
function processProductImage(inputOrOptions, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (Buffer.isBuffer(inputOrOptions)) {
            // Legacy call shape: same behavior as before (DEFAULT_SETTINGS, "custom"
            // framing), returns a bare buffer.
            const cutout = yield removeBackground(inputOrOptions, mimeType);
            const cleaned = yield (0, sharp_1.default)(cutout).normalize().sharpen({ sigma: 0.5 }).toBuffer();
            return composeStudioImage(cleaned, exports.DEFAULT_SETTINGS);
        }
        const { input, mimeType: mt, viewType = "custom", settings } = inputOrOptions;
        const preset = (_a = exports.VIEW_PRESETS[viewType]) !== null && _a !== void 0 ? _a : exports.VIEW_PRESETS.custom;
        const merged = Object.assign(Object.assign({}, preset), settings);
        const cutout = yield removeBackground(input, mt);
        const cleaned = yield (0, sharp_1.default)(cutout).normalize().sharpen({ sigma: 0.5 }).toBuffer();
        const studioSettings = {
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
        const buffer = yield renderStudioImage(cleaned, studioSettings);
        return {
            buffer,
            width: MASTER_SIZE,
            height: MASTER_SIZE,
            viewType,
            appliedScale: merged.scale,
            appliedPosition: merged.position,
        };
    });
}
