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
exports.DEFAULT_SETTINGS = void 0;
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
/**
 * Composes a cleaned (background-removed) product cutout onto the studio
 * canvas per the given settings: trim -> fit into padded square -> position
 * -> optional drop shadow -> background. Pure function of its inputs.
 */
function composeStudioImage(cleanedBuffer_1) {
    return __awaiter(this, arguments, void 0, function* (cleanedBuffer, settings = exports.DEFAULT_SETTINGS) {
        var _a, _b;
        let productBuffer = cleanedBuffer;
        try {
            productBuffer = yield (0, sharp_1.default)(cleanedBuffer).trim().toBuffer();
        }
        catch (_c) {
            // Edges weren't uniform enough to trim (e.g. already tight crop) — use
            // the untrimmed cutout, composition below still centers it correctly.
        }
        const maxProductSize = Math.round(MASTER_SIZE * (1 - 2 * PADDING_RATIOS[settings.padding]));
        const resizedProduct = yield (0, sharp_1.default)(productBuffer)
            .resize({ width: maxProductSize, height: maxProductSize, fit: "inside" })
            .toBuffer();
        const resizedMeta = yield (0, sharp_1.default)(resizedProduct).metadata();
        const productWidth = (_a = resizedMeta.width) !== null && _a !== void 0 ? _a : maxProductSize;
        const productHeight = (_b = resizedMeta.height) !== null && _b !== void 0 ? _b : maxProductSize;
        const anchor = POSITION_ANCHORS[settings.position];
        const left = Math.round(anchor.x * (MASTER_SIZE - productWidth));
        const top = Math.round(anchor.y * (MASTER_SIZE - productHeight));
        const compositeLayers = [];
        if (settings.shadow) {
            // Soft drop shadow: blur the product's own alpha silhouette, fade it
            // to ~35% opacity, offset it down a few px, composite underneath.
            const shadowOffset = Math.round(MASTER_SIZE * 0.015);
            const shadowBlur = Math.round(MASTER_SIZE * 0.02);
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
            compositeLayers.push({ input: shadowLayer, left, top: top + shadowOffset });
        }
        compositeLayers.push({ input: resizedProduct, left, top });
        let masterPipeline = (0, sharp_1.default)({
            create: { width: MASTER_SIZE, height: MASTER_SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).composite(compositeLayers);
        if (settings.background !== "transparent") {
            masterPipeline = masterPipeline.flatten({ background: "#ffffff" });
        }
        return masterPipeline.webp({ quality: 92 }).toBuffer();
    });
}
/** Full pipeline: remove background -> light cleanup -> studio composite. */
function processProductImage(inputBuffer, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        const cutout = yield removeBackground(inputBuffer, mimeType);
        const cleaned = yield (0, sharp_1.default)(cutout).normalize().sharpen({ sigma: 0.5 }).toBuffer();
        return composeStudioImage(cleaned, exports.DEFAULT_SETTINGS);
    });
}
