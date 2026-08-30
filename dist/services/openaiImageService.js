"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.REFLECTION_PROMPT_VERSION = exports.VIEW_TYPE_DESCRIPTIONS = exports.IMAGE_PROMPT_VERSION = void 0;
exports.buildLapsharkImagePrompt = buildLapsharkImagePrompt;
exports.buildReflectionRemovalPrompt = buildReflectionRemovalPrompt;
exports.testConnection = testConnection;
exports.computeEditSize = computeEditSize;
exports.generateEcommerceEdit = generateEcommerceEdit;
exports.classifyOpenAIError = classifyOpenAIError;
const openai_1 = __importStar(require("openai"));
const sharp_1 = __importDefault(require("sharp"));
// One provider, one file — mirrors imagekit.ts owning ImageKit and
// imageProcessing.ts owning Sharp/PhotoRoom. Keeps the OpenAI SDK/retry/
// error-classification concerns out of the Sharp file and vice versa;
// productImageOrchestrator.ts composes both.
// Bumped from lapshark-v1 after the HP ProBook 640 G8 regression (OpenAI
// altering chassis texture despite the v1 prompt's preservation language,
// on top of the ThinkPad L480 case of it changing an on-screen date) — the
// bump changes the processing fingerprint so old, unreviewed generations
// aren't silently treated as still-current; already-approved/published
// versions are untouched (Phase 25A #11).
exports.IMAGE_PROMPT_VERSION = "lapshark-v2";
// Deliberately avoids ANY language that could read as an invitation to
// improve/beautify the product (no "premium", "flawless", "pristine",
// "enhanced", "polished", "perfect") — that vocabulary is exactly what
// nudges a generative model toward touching up a refurbished unit's real
// wear. "Edit ONLY the background" + an explicit not-a-resize-tool framing
// pairs with size computed from the source's own aspect ratio in
// generateEcommerceEdit below — Sharp, not OpenAI, decides final geometry.
const CORE_INSTRUCTIONS = `You are an ecommerce background-editing tool. You do not redesign,
retouch, or improve products — you only edit the background and overall
presentation around a product that must stay completely unchanged.

CRITICAL RULE — THE PHYSICAL LAPTOP MUST BE PRESERVED EXACTLY.

The photographed laptop is the source of truth and is immutable. Edit
ONLY the background and overall presentation. Do not redraw,
regenerate, reconstruct, retouch, repair, clean, beautify, smooth,
sharpen, repaint, recolor, reshape, or alter any part of the laptop in
any way.

Do not modify, touch up, or change:

- screen contents
- keyboard
- keys
- trackpad
- chassis
- logos
- stickers
- labels
- ports
- hinges
- bezels
- speakers
- vents
- scratches
- scuffs
- dents
- surface wear
- surface texture
- physical condition
- colour
- material
- finish
- proportions

Do not remove imperfections. Do not add details. Do not invent
details. Do not make a used or refurbished laptop look new. Do not add
hardware. Do not remove hardware. Do not add decorative objects, text,
or new branding.

The laptop must remain the exact same physical product shown in the
source photograph — same model, same condition, same everything except
the background around it.

Do not change the camera perspective, viewing angle, or product
geometry. Do not create a different laptop. Do not resize, recompose,
crop, or reposition the product within the frame — leave that to later
processing; your only job is the background.

Tasks:

1. Remove the original background.
2. Place the product on a clean, neutral background suitable for
   ecommerce.
3. Preserve the entire laptop exactly as photographed.
4. Preserve the original viewing angle and geometry exactly.
5. Preserve original colours and physical condition exactly.

Accuracy is more important than creativity. Do not regenerate the
laptop. Do not change the product. Output a clean ecommerce product
photograph of the exact same physical laptop.`;
// Presentation-only sentences — must never instruct a new physical camera
// angle, only how the existing photograph should be presented (Phase 7).
// Includes the codebase's existing `closed_rear` view (not in the spec's
// list) so it keeps working rather than losing its prompt coverage.
exports.VIEW_TYPE_DESCRIPTIONS = {
    open_front: "Preserve the exact open-laptop front angle shown in the source image. Center the product and maintain balanced margins.",
    open_angle: "Preserve the exact open-laptop angle shown in the source image. Do not change the physical perspective.",
    closed_top: "Preserve the exact closed-laptop top view shown in the source image. Do not change the physical perspective.",
    closed_angle: "Preserve the exact closed-laptop angled view shown in the source image. Do not change the physical perspective.",
    closed_rear: "Preserve the exact closed-laptop rear view shown in the source image. Preserve all rear vents, hinges and labels.",
    bottom: "Preserve the exact bottom view shown in the source image. Preserve all vents, feet, labels and other physical details.",
    left_side: "Preserve the exact left-side profile view shown in the source image. Do not change the physical perspective.",
    right_side: "Preserve the exact right-side profile view shown in the source image. Do not change the physical perspective.",
    ports: "Preserve the exact ports/connectivity view shown in the source image. Preserve every port, label and physical detail exactly.",
    detail: "Preserve the exact close-up detail view shown in the source image. Do not change the physical perspective or crop out visible context.",
    custom: "Preserve the exact viewing angle shown in the source image. Do not change the physical perspective.",
};
// Only viewType affects the prompt. background/shadow/brightness/scale stay
// Sharp-only (Phase 9/25A) — they must never trigger a new OpenAI call, so
// they can never be an input to this function.
function buildLapsharkImagePrompt(opts) {
    var _a;
    const viewSentence = (_a = exports.VIEW_TYPE_DESCRIPTIONS[opts.viewType]) !== null && _a !== void 0 ? _a : exports.VIEW_TYPE_DESCRIPTIONS.custom;
    return `${CORE_INSTRUCTIONS}\n\n${viewSentence}`;
}
// Reflection removal's own prompt, kept separate from buildLapsharkImagePrompt
// — a background edit and a glare-reduction edit are different operations
// and must never share one instruction block. Same avoid-list of
// beautifying vocabulary applies.
exports.REFLECTION_PROMPT_VERSION = "reflection-v1";
function buildReflectionRemovalPrompt() {
    return `Reduce only the obvious photographic light glare/reflection visible
on the laptop surface.

Preserve the exact physical laptop.

Do not regenerate or redraw any part of the laptop.

Do not alter the chassis shape, colour, texture, keyboard, trackpad,
screen, logos, stickers, ports, hinges, scratches, scuffs, dents or
physical condition.

Do not remove genuine product imperfections.

Do not reconstruct areas where reflection overlaps important product
details.

If removing the reflection would require inventing product detail,
leave the reflection unchanged.`;
}
let client = null;
let clientKey = null;
function getClient() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
        throw new Error("OPENAI_API_KEY is not set");
    // Rebuilds when the key changes at runtime (the admin "Set API Key" UI
    // updates process.env directly, without a process restart) rather than
    // only checking `!client` once.
    if (!client || clientKey !== apiKey) {
        client = new openai_1.default({ apiKey });
        clientKey = apiKey;
    }
    return client;
}
// Cheap validity check for the "Test Connection" admin UI — retrieves the
// model, which costs nothing, instead of running a real (billed) image edit.
function testConnection() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!process.env.OPENAI_API_KEY) {
            return { success: false, message: "OPENAI_API_KEY is not set." };
        }
        try {
            yield getClient().models.retrieve("gpt-image-2");
            return { success: true, message: "Connected — gpt-image-2 is available for this API key." };
        }
        catch (err) {
            const classified = classifyOpenAIError(err);
            if (classified.status === 401)
                return { success: false, message: "Invalid API key." };
            if (classified.status === 404) {
                return { success: false, message: "Key looks valid, but gpt-image-2 isn't accessible for this account (Organization Verification may be required)." };
            }
            return { success: false, message: "Could not reach OpenAI. Please check the key and try again." };
        }
    });
}
const EDIT_MAX_DIMENSION = 1536; // stays under gpt-image-2's "experimental above 2560x1440" tier
const EDIT_MIN_DIMENSION = 512;
// Forcing a square 2000x2000 edit target made OpenAI decide how much of
// that square the (non-square) product should occupy — i.e. it was
// determining composition, which the pipeline explicitly doesn't want
// (Sharp does that deterministically afterward, from a source-matched
// aspect ratio + a bounding-box crop). Requesting a size close to the
// original's own aspect ratio instead means OpenAI is only asked to edit
// the photo it was given, not compose a new layout inside a shape it
// wasn't given.
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
// Single edit call — the ONE OpenAI operation per processing attempt. Sharp
// (not OpenAI) produces the 2000/1200/500 variants from this one buffer.
function generateEcommerceEdit(originalBuffer, mimeType, prompt) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const openai = getClient();
        const file = yield (0, openai_1.toFile)(originalBuffer, "source", { type: mimeType });
        const meta = yield (0, sharp_1.default)(originalBuffer).metadata();
        const size = meta.width && meta.height ? computeEditSize(meta.width, meta.height) : "1024x1024";
        const response = yield openai.images.edit({
            model: "gpt-image-2",
            image: file,
            prompt,
            size: size,
            // input_fidelity is documented in the SDK's types as supported for
            // "gpt-image-1.5 and later", but the live API rejects it for
            // gpt-image-2 specifically (400: "does not support the 'input_fidelity'
            // parameter") — confirmed by an actual call, not the docs. Product
            // preservation is instead carried entirely by the text prompt's
            // extensive do-not-change list (see CORE_INSTRUCTIONS above).
            n: 1,
        });
        const b64 = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.b64_json;
        if (!b64)
            throw new Error("OpenAI returned no image data");
        return {
            buffer: Buffer.from(b64, "base64"),
            mimeType: "image/png",
            // Stored as opaque JSON rather than mapped to named fields — the exact
            // usage shape isn't a stable contract; imageCostControl.estimateCost
            // reads out of it defensively.
            usage: (_c = response.usage) !== null && _c !== void 0 ? _c : null,
        };
    });
}
// Retry looping lives in productImageOrchestrator (each attempt needs its
// own usage row), not here — this only classifies.
function classifyOpenAIError(err) {
    const status = err === null || err === void 0 ? void 0 : err.status;
    const message = err instanceof Error ? err.message : String(err);
    const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);
    const isNetworkOrTimeout = status === undefined &&
        /timeout|network|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message);
    return {
        transient: (status !== undefined && transientStatuses.has(status)) || isNetworkOrTimeout,
        status,
        message,
    };
}
