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
exports.GeometryMismatchError = void 0;
exports.computeEditSize = computeEditSize;
exports.orientationOf = orientationOf;
exports.editProductImage = editProductImage;
const sharp_1 = __importDefault(require("sharp"));
const openaiClient_1 = require("../openaiClient");
const productImageTypes_1 = require("./productImageTypes");
const productImagePrompts_1 = require("./productImagePrompts");
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
function computeEditSize(width, height) {
    const scale = Math.min(1, EDIT_MAX_DIMENSION / Math.max(width, height));
    let w = Math.round((width * scale) / 16) * 16;
    let h = Math.round((height * scale) / 16) * 16;
    w = Math.max(EDIT_MIN_DIMENSION, w);
    h = Math.max(EDIT_MIN_DIMENSION, h);
    // gpt-image-2 requires the aspect ratio to stay within 1:3..3:1.
    if (w / h > 3)
        w = h * 3;
    if (h / w > 3)
        h = w * 3;
    return `${w}x${h}`;
}
// Distinguishable from a plain Error so the orchestrator's retry loop can
// treat it as worth retrying (it's model unpredictability on this specific
// attempt, not invalid input or a content-policy rejection — a second
// generation has a real chance of preserving orientation correctly).
class GeometryMismatchError extends Error {
}
exports.GeometryMismatchError = GeometryMismatchError;
function orientationOf(width, height) {
    const ratio = width / height;
    if (ratio > 1.15)
        return "landscape";
    if (ratio < 1 / 1.15)
        return "portrait";
    return "square";
}
// The one entry point for ai_edit mode's OpenAI call — detects the image
// type, builds the matching prompt, runs the edit, and refuses the result
// outright if OpenAI silently changed the product's orientation (a cheap,
// reliable geometry sanity check — not a full product-fidelity judgment,
// just a hard stop on the specific "device got rotated" failure mode).
// Nothing else in the codebase should call openaiClient.editImage directly
// for product photos.
function editProductImage(originalBuffer, mimeType, viewType) {
    return __awaiter(this, void 0, void 0, function* () {
        const sourceMeta = yield (0, sharp_1.default)(originalBuffer).metadata();
        const size = sourceMeta.width && sourceMeta.height ? computeEditSize(sourceMeta.width, sourceMeta.height) : "1024x1024";
        const imageType = yield (0, productImageTypes_1.detectImageType)(viewType, originalBuffer);
        const prompt = (0, productImagePrompts_1.buildProductImagePrompt)(imageType);
        const result = yield (0, openaiClient_1.editImage)(originalBuffer, mimeType, prompt, size);
        if (sourceMeta.width && sourceMeta.height) {
            const sourceOrientation = orientationOf(sourceMeta.width, sourceMeta.height);
            if (sourceOrientation !== "square") {
                const outMeta = yield (0, sharp_1.default)(result.buffer).metadata();
                if (outMeta.width && outMeta.height && orientationOf(outMeta.width, outMeta.height) !== sourceOrientation) {
                    throw new GeometryMismatchError(`AI edit changed the product's orientation (source was ${sourceOrientation}, result was ${orientationOf(outMeta.width, outMeta.height)}) — refusing this result`);
                }
            }
        }
        return Object.assign(Object.assign({}, result), { imageType });
    });
}
