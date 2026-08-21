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
exports.deleteGalleryImage = exports.getGalleryImages = exports.uploadMultipleGalleryImages = exports.uploadGalleryImage = exports.galleryUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const imagekit_1 = __importStar(require("../services/imagekit"));
// Configure Multer (Memory Storage)
const storage = multer_1.default.memoryStorage();
exports.galleryUpload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});
/**
 * ==========================
 * Upload Image
 * POST /api/gallery/upload
 * ==========================
 */
const uploadGalleryImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "No image uploaded",
            });
        }
        const upload = yield (0, imagekit_1.uploadToImageKit)(req.file, "/lapshark/gallery");
        return res.status(201).json({
            success: true,
            image: {
                fileId: upload.fileId,
                url: upload.url,
                thumbnailUrl: upload.thumbnailUrl,
                width: upload.width,
                height: upload.height,
                size: upload.size,
            },
        });
    }
    catch (error) {
        console.error("GALLERY UPLOAD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload image",
        });
    }
});
exports.uploadGalleryImage = uploadGalleryImage;
/**
 * ==========================
 * Upload Multiple Images
 * POST /api/gallery/upload/multiple
 * ==========================
 */
const uploadMultipleGalleryImages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No files uploaded"
            });
        }
        const uploadPromises = files.map(file => (0, imagekit_1.uploadToImageKit)(file, "/lapshark/gallery"));
        const results = yield Promise.all(uploadPromises);
        return res.status(201).json({
            success: true,
            images: results.map(upload => ({
                fileId: upload.fileId,
                url: upload.url,
                thumbnailUrl: upload.thumbnailUrl,
                width: upload.width,
                height: upload.height,
                size: upload.size,
            })),
            count: results.length
        });
    }
    catch (error) {
        console.error("GALLERY MULTI UPLOAD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload images",
        });
    }
});
exports.uploadMultipleGalleryImages = uploadMultipleGalleryImages;
/**
 * ==========================
 * Get Gallery Images
 * GET /api/gallery
 * ==========================
 */
const getGalleryImages = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = yield imagekit_1.default.listFiles({
            path: "/lapshark/gallery",
            limit: 100,
        });
        const images = files
            .filter((file) => file.type === "file")
            .map((file) => ({
            fileId: file.fileId,
            name: file.name,
            url: file.url,
            thumbnailUrl: file.thumbnailUrl, // ✅ now valid
            size: file.size,
            width: file.width,
            height: file.height,
            createdAt: file.createdAt,
        }));
        return res.json({
            success: true,
            images,
            count: images.length,
        });
    }
    catch (error) {
        console.error("GET GALLERY ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch gallery images",
        });
    }
});
exports.getGalleryImages = getGalleryImages;
/**
 * ==========================
 * Delete Image
 * DELETE /api/gallery/:fileId
 * ==========================
 */
const deleteGalleryImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Try getting fileId from params first, otherwise body (for backward compatibility if needed)
        const fileId = req.params.fileId || req.body.fileId;
        const { url } = req.body;
        // If we only have URL and no fileId, we might be in trouble since ImageKit delete needs fileId.
        // However, for now we enforce fileId.
        if (!fileId) {
            // Fallback: If url is provided, maybe we can try to find the file (not implemented efficiently here)
            // or just Error.
            return res.status(400).json({
                success: false,
                message: "fileId is required",
            });
        }
        yield imagekit_1.default.deleteFile(fileId);
        return res.json({
            success: true,
            message: "Image deleted successfully",
            fileId,
        });
    }
    catch (error) {
        console.error("DELETE GALLERY ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete image",
        });
    }
});
exports.deleteGalleryImage = deleteGalleryImage;
