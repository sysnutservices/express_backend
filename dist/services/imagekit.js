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
exports.uploadToImageKit = exports.imagekit = void 0;
const imagekit_1 = __importDefault(require("imagekit"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
exports.imagekit = new imagekit_1.default({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});
const uploadToImageKit = (file, folder) => __awaiter(void 0, void 0, void 0, function* () {
    const ext = path_1.default.extname(file.originalname);
    const filename = "gallery-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    const uploaded = yield exports.imagekit.upload({
        file: file.buffer, // buffer (memoryStorage)
        fileName: filename,
        folder,
    });
    return uploaded; // ✅ RETURN FULL OBJECT
});
exports.uploadToImageKit = uploadToImageKit;
exports.default = exports.imagekit;
