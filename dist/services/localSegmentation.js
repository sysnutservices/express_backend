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
exports.computeAlphaStats = computeAlphaStats;
exports.computeBBoxFromMask = computeBBoxFromMask;
exports.largestComponentMask = largestComponentMask;
exports.boxMorph = boxMorph;
exports.removeBackgroundLocal = removeBackgroundLocal;
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const path_1 = __importDefault(require("path"));
const sharp_1 = __importDefault(require("sharp"));
const ort = __importStar(require("onnxruntime-node"));
// Deterministic, non-generative background removal — the default catalogue
// pipeline. Unlike OpenAI's image edit, this NEVER touches product pixels:
// every pixel inside the detected product silhouette is byte-identical to
// the original photograph. Benchmarked against a real LapShark product photo
// (branded studio backdrop, dark chassis, screen content) before adoption —
// see the ThinkPad L480 regression check in localSegmentation.selftest.ts.
//
// Model: IS-Net general-use (Apache 2.0 — danielgatis/rembg's default model,
// genuinely free for commercial use, unlike AGPL-licensed wrapper packages).
// Downloaded on first use (178MB), cached in models/ (gitignored).
const MODEL_DIR = path_1.default.join(process.cwd(), "models");
const MODEL_PATH = path_1.default.join(MODEL_DIR, "isnet-general-use.onnx");
const MODEL_URL = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx";
const INPUT_SIZE = 1024;
// Generous — only seeds which pixels count as "possibly foreground" for the
// connected-component step below; the final cutoff is BBOX_THRESHOLD.
const CCL_SEED_THRESHOLD = 180;
// Final alpha cutoff, applied only AFTER the mask is resized to full
// resolution — thresholding a binary mask BEFORE a large upscale causes
// lanczos ringing (confirmed empirically), so the resize always runs on the
// continuous probability mask first.
const BBOX_THRESHOLD = 200;
// Fills small notches the CCL step leaves right at a boundary with removed
// clutter (the model's confidence dips slightly on real product pixels
// immediately next to high-contrast background noise). Small enough to not
// visibly change the silhouette shape.
const MORPH_RADIUS = 3;
function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const request = (currentUrl) => {
            https_1.default
                .get(currentUrl, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    request(res.headers.location);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`Segmentation model download failed: HTTP ${res.statusCode}`));
                    return;
                }
                const file = fs_1.default.createWriteStream(destPath);
                res.pipe(file);
                file.on("finish", () => file.close(() => resolve()));
                file.on("error", reject);
            })
                .on("error", reject);
        };
        request(url);
    });
}
function ensureModel() {
    return __awaiter(this, void 0, void 0, function* () {
        if (fs_1.default.existsSync(MODEL_PATH))
            return;
        fs_1.default.mkdirSync(MODEL_DIR, { recursive: true });
        const tmpPath = `${MODEL_PATH}.download`;
        yield downloadFile(MODEL_URL, tmpPath);
        fs_1.default.renameSync(tmpPath, MODEL_PATH);
    });
}
let sessionPromise = null;
function getSession() {
    if (!sessionPromise) {
        sessionPromise = (() => __awaiter(this, void 0, void 0, function* () {
            yield ensureModel();
            return ort.InferenceSession.create(MODEL_PATH);
        }))();
    }
    return sessionPromise;
}
// Run on the FULL-FRAME mask, before any bbox crop trims the transparent
// margin away — cropping is expected to leave little/no transparency in the
// output (that's a tight, correct crop, not a failure), so validating after
// crop would misread a good result as broken. alphaMax === alphaMin means
// the model found either everything or nothing to be background: a real
// segmentation, run on a real product photo, always produces a mix.
function computeAlphaStats(alpha) {
    let alphaMin = 255, alphaMax = 0, transparentCount = 0;
    for (let i = 0; i < alpha.length; i++) {
        const a = alpha[i];
        if (a < alphaMin)
            alphaMin = a;
        if (a > alphaMax)
            alphaMax = a;
        if (a === 0)
            transparentCount++;
    }
    return { alphaMin, alphaMax, transparentPercent: (transparentCount / alpha.length) * 100 };
}
function computeBBoxFromMask(mask, width, height, threshold) {
    let minX = width, maxX = -1, minY = height, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (mask[y * width + x] > threshold) {
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
                if (y < minY)
                    minY = y;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (maxX < 0)
        return null;
    return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
// Iterative BFS connected-component labeling (4-connectivity). Keeps only the
// single largest foreground blob — the product is one large connected
// region; background clutter (a backdrop's text/graphics near the product)
// is a separate, smaller, disconnected region regardless of how much
// confidence the model gave it.
function largestComponentMask(binary, width, height) {
    const visited = new Uint8Array(width * height);
    const keep = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let bestSize = 0;
    let bestPixels = [];
    for (let start = 0; start < width * height; start++) {
        if (binary[start] === 0 || visited[start])
            continue;
        let qHead = 0, qTail = 0;
        queue[qTail++] = start;
        visited[start] = 1;
        const pixels = [start];
        while (qHead < qTail) {
            const p = queue[qHead++];
            const x = p % width, y = (p / width) | 0;
            if (x > 0 && binary[p - 1] && !visited[p - 1]) {
                visited[p - 1] = 1;
                queue[qTail++] = p - 1;
                pixels.push(p - 1);
            }
            if (x < width - 1 && binary[p + 1] && !visited[p + 1]) {
                visited[p + 1] = 1;
                queue[qTail++] = p + 1;
                pixels.push(p + 1);
            }
            if (y > 0 && binary[p - width] && !visited[p - width]) {
                visited[p - width] = 1;
                queue[qTail++] = p - width;
                pixels.push(p - width);
            }
            if (y < height - 1 && binary[p + width] && !visited[p + width]) {
                visited[p + width] = 1;
                queue[qTail++] = p + width;
                pixels.push(p + width);
            }
        }
        if (pixels.length > bestSize) {
            bestSize = pixels.length;
            bestPixels = pixels;
        }
    }
    for (const p of bestPixels)
        keep[p] = 1;
    return keep;
}
// Separable box max/min filter — sharp 0.33 has no dilate()/erode(), this is
// a standard cheap approximation of disk-shaped morphology for a small radius.
function boxMorph(src, width, height, radius, isMax) {
    const tmp = new Uint8Array(width * height);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let v = isMax ? 0 : 255;
            for (let dx = -radius; dx <= radius; dx++) {
                const xx = x + dx;
                if (xx < 0 || xx >= width)
                    continue;
                const s = src[y * width + xx];
                v = isMax ? Math.max(v, s) : Math.min(v, s);
            }
            tmp[y * width + x] = v;
        }
    }
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let v = isMax ? 0 : 255;
            for (let dy = -radius; dy <= radius; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= height)
                    continue;
                const s = tmp[yy * width + x];
                v = isMax ? Math.max(v, s) : Math.min(v, s);
            }
            out[y * width + x] = v;
        }
    }
    return out;
}
// Returns an RGBA PNG cutout, already cropped tightly to the detected
// product's bounding box — a drop-in replacement for PhotoRoom's
// removeBackground() as the input to composeStudioImage/renderStudioImage
// in imageProcessing.ts (same downstream Sharp compositing, unchanged).
function removeBackgroundLocal(inputBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const session = yield getSession();
        const meta = yield (0, sharp_1.default)(inputBuffer).metadata();
        if (!meta.width || !meta.height)
            throw new Error("Could not read image dimensions");
        const { data } = yield (0, sharp_1.default)(inputBuffer)
            .removeAlpha()
            .resize(INPUT_SIZE, INPUT_SIZE, { fit: "fill" })
            .raw()
            .toBuffer({ resolveWithObject: true });
        const pixelCount = INPUT_SIZE * INPUT_SIZE;
        const floatData = new Float32Array(3 * pixelCount);
        for (let i = 0; i < pixelCount; i++) {
            floatData[i] = data[i * 3] / 255 - 0.5;
            floatData[pixelCount + i] = data[i * 3 + 1] / 255 - 0.5;
            floatData[2 * pixelCount + i] = data[i * 3 + 2] / 255 - 0.5;
        }
        const inputTensor = new ort.Tensor("float32", floatData, [1, 3, INPUT_SIZE, INPUT_SIZE]);
        const results = yield session.run({ [session.inputNames[0]]: inputTensor });
        const outData = results[session.outputNames[0]].data;
        let mn = Infinity, mx = -Infinity;
        for (let i = 0; i < outData.length; i++) {
            if (outData[i] < mn)
                mn = outData[i];
            if (outData[i] > mx)
                mx = outData[i];
        }
        const range = mx - mn || 1;
        const smallMask = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++)
            smallMask[i] = Math.round(((outData[i] - mn) / range) * 255);
        const binary = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++)
            binary[i] = smallMask[i] > CCL_SEED_THRESHOLD ? 1 : 0;
        const keep = largestComponentMask(binary, INPUT_SIZE, INPUT_SIZE);
        const cleanedSmallMask = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++)
            cleanedSmallMask[i] = keep[i] ? smallMask[i] : 0;
        const binaryForMorph = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++)
            binaryForMorph[i] = cleanedSmallMask[i] > 100 ? 255 : 0;
        const dilated = boxMorph(binaryForMorph, INPUT_SIZE, INPUT_SIZE, MORPH_RADIUS, true);
        const closed = boxMorph(dilated, INPUT_SIZE, INPUT_SIZE, MORPH_RADIUS, false);
        for (let i = 0; i < pixelCount; i++) {
            if (closed[i] > 127 && cleanedSmallMask[i] === 0)
                cleanedSmallMask[i] = 255;
        }
        // Resize the CONTINUOUS mask with fit:"fill" — must match the fit:"fill"
        // used for the model input above, or the mask misaligns against the real
        // image (confirmed empirically: "cover", sharp's default, silently crops
        // the mask against the wrong aspect ratio).
        const { data: resizedMask } = yield (0, sharp_1.default)(Buffer.from(cleanedSmallMask), {
            raw: { width: INPUT_SIZE, height: INPUT_SIZE, channels: 1 },
        })
            .resize(meta.width, meta.height, { kernel: "lanczos3", fit: "fill" })
            .extractChannel(0)
            .raw()
            .toBuffer({ resolveWithObject: true });
        const finalAlpha = Buffer.alloc(resizedMask.length);
        for (let i = 0; i < resizedMask.length; i++)
            finalAlpha[i] = resizedMask[i] > BBOX_THRESHOLD ? 255 : 0;
        // Hard failure, not a soft warning — a mask with zero contrast means
        // segmentation didn't actually run correctly on this photo, so nothing
        // downstream can be trusted. computeBBoxFromMask below already throws for
        // the all-background case (bbox null); this catches the other degenerate
        // case it can't: everything read as foreground.
        const alphaStats = computeAlphaStats(finalAlpha);
        if (alphaStats.alphaMax === alphaStats.alphaMin) {
            throw new Error(`BACKGROUND_REMOVAL_FAILED — no transparency detected (alphaMin=${alphaStats.alphaMin}, alphaMax=${alphaStats.alphaMax})`);
        }
        const bbox = computeBBoxFromMask(finalAlpha, meta.width, meta.height, 127);
        if (!bbox)
            throw new Error("No product detected in image");
        const rgbBuffer = yield (0, sharp_1.default)(inputBuffer).removeAlpha().raw().toBuffer();
        // Materialize before extract() — chaining joinChannel().extract() directly
        // silently no-ops the crop (a sharp chaining quirk, confirmed empirically).
        const rgba = yield (0, sharp_1.default)(rgbBuffer, { raw: { width: meta.width, height: meta.height, channels: 3 } })
            .joinChannel(finalAlpha, { raw: { width: meta.width, height: meta.height, channels: 1 } })
            .png()
            .toBuffer();
        return (0, sharp_1.default)(rgba).extract(bbox).png().toBuffer();
    });
}
