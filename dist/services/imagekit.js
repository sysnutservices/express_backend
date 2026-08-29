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
exports.uploadBufferToImageKit = exports.uploadUrlToImageKit = exports.uploadToImageKit = exports.imagekit = void 0;
const imagekit_1 = __importDefault(require("imagekit"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const slugify_1 = __importDefault(require("slugify"));
dotenv_1.default.config();
exports.imagekit = new imagekit_1.default({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});
// SEO-friendly file names: "dell-latitude-5400-i5-8gb.jpg" beats
// "gallery-1700000000-123456789.jpg" for image search / alt-text-less pages.
// ImageKit's default useUniqueFileName:true still appends its own suffix
// server-side, so collisions are handled without us adding random bytes here.
function seoFilename(hint, fallback, ext = "") {
    const slug = hint ? (0, slugify_1.default)(hint, { lower: true, strict: true }) : "";
    return (slug || fallback).slice(0, 100) + ext;
}
const uploadToImageKit = (file, folder, nameHint) => __awaiter(void 0, void 0, void 0, function* () {
    const ext = path_1.default.extname(file.originalname);
    const filename = seoFilename(nameHint, "product-image", ext);
    const uploaded = yield exports.imagekit.upload({
        file: file.buffer, // buffer (memoryStorage)
        fileName: filename,
        folder,
    });
    return uploaded; // ✅ RETURN FULL OBJECT
});
exports.uploadToImageKit = uploadToImageKit;
// Same as uploadToImageKit but for an already-hosted remote image (e.g. from
// the CRM's product sync) — ImageKit's own upload API accepts a URL directly
// as `file` and fetches the bytes server-side, so no separate download step
// is needed here.
const uploadUrlToImageKit = (url, folder, nameHint) => __awaiter(void 0, void 0, void 0, function* () {
    const filename = seoFilename(nameHint, "product-image");
    const uploaded = yield exports.imagekit.upload({
        file: url,
        fileName: filename,
        folder,
    });
    return uploaded;
});
exports.uploadUrlToImageKit = uploadUrlToImageKit;
// For a buffer we already have in memory (e.g. the output of the PhotoRoom
// background-removal + compositing pipeline in imageProcessing.ts).
const uploadBufferToImageKit = (buffer, folder, nameHint) => __awaiter(void 0, void 0, void 0, function* () {
    const filename = seoFilename(nameHint, "product-image", ".webp");
    const uploaded = yield exports.imagekit.upload({
        file: buffer,
        fileName: filename,
        folder,
    });
    return uploaded;
});
exports.uploadBufferToImageKit = uploadBufferToImageKit;
exports.default = exports.imagekit;
