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
Object.defineProperty(exports, "__esModule", { value: true });
exports.testConnection = testConnection;
exports.editImage = editImage;
exports.classifyOpenAIError = classifyOpenAIError;
const openai_1 = __importStar(require("openai"));
// Generic OpenAI plumbing only — no product-specific prompts here. Prompt
// content and image-type logic live in services/productImage/, which is the
// only caller of editImage(). Mirrors imagekit.ts owning ImageKit.
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
// One edit call — the ONE OpenAI operation per processing attempt. Sharp
// (not OpenAI) still produces the 2000/1200/500 catalogue variants from
// this one buffer; `size` is the caller's choice (see
// productImage/productImageEditor.ts for why it's a fixed 1:1 square here).
function editImage(originalBuffer, mimeType, prompt, size) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const openai = getClient();
        const file = yield (0, openai_1.toFile)(originalBuffer, "source", { type: mimeType });
        const response = yield openai.images.edit({
            model: "gpt-image-2",
            image: file,
            prompt,
            size: size,
            // input_fidelity is documented in the SDK's types as supported for
            // "gpt-image-1.5 and later", but the live API rejects it for
            // gpt-image-2 specifically (400: "does not support the 'input_fidelity'
            // parameter") — confirmed by an actual call, not the docs. Product
            // preservation is instead carried entirely by the text prompt.
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
