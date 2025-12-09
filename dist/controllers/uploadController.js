"use strict";
// routes/upload.ts
// Express.js TypeScript API for Image Upload (Local Storage)
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteImage = exports.getImages = exports.uploadMultipleImages = exports.uploadSingleImage = exports.galleryUpload = void 0;
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = express_1.default.Router();
// Ensure uploads directory exists
const uploadDir = path_1.default.join(__dirname, '../../uploads');
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
// Configure Multer storage
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${timestamp}-${randomString}${ext}`);
    }
});
// File filter - only allow images
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    }
    else {
        cb(new Error('Only image files are allowed!'));
    }
};
// Configure upload middleware
exports.galleryUpload = (0, multer_1.default)({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});
// POST /api/upload - Upload single image
const uploadSingleImage = (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }
        // Return the URL
        const url = `/uploads/${req.file.filename}`;
        res.json({
            success: true,
            url: url,
            filename: req.file.filename,
            size: req.file.size,
            type: req.file.mimetype
        });
    }
    catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload file'
        });
    }
};
exports.uploadSingleImage = uploadSingleImage;
// POST /api/upload/multiple - Upload multiple images
const uploadMultipleImages = (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }
        const uploadedFiles = files.map(file => ({
            url: `/uploads/${file.filename}`,
            filename: file.filename,
            size: file.size,
            type: file.mimetype
        }));
        res.json({
            success: true,
            files: uploadedFiles,
            count: files.length
        });
    }
    catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload files'
        });
    }
};
exports.uploadMultipleImages = uploadMultipleImages;
// GET /api/images - Get list of all uploaded images
const getImages = (req, res) => {
    try {
        if (!fs_1.default.existsSync(uploadDir)) {
            return res.json({ images: [] });
        }
        const files = fs_1.default.readdirSync(uploadDir);
        const images = files
            .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
            .map(file => `/uploads/${file}`);
        res.json({
            success: true,
            images: images,
            count: images.length
        });
    }
    catch (error) {
        console.error('Error reading uploads directory:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to read images',
            images: []
        });
    }
};
exports.getImages = getImages;
// DELETE /api/delete-image - Delete an image
const deleteImage = (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'No URL provided'
            });
        }
        // Extract filename from URL
        const filename = url.split('/').pop();
        if (!filename) {
            return res.status(400).json({
                success: false,
                error: 'Invalid URL format'
            });
        }
        // Construct file path
        const filepath = path_1.default.join(uploadDir, filename);
        // Check if file exists
        if (!fs_1.default.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }
        // Delete the file
        fs_1.default.unlinkSync(filepath);
        res.json({
            success: true,
            message: 'Image deleted successfully',
            deletedFile: filename
        });
    }
    catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete file'
        });
    }
};
exports.deleteImage = deleteImage;
// Error handling middleware for multer errors
router.use((error, req, res, next) => {
    if (error instanceof multer_1.default.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                error: 'File is too large. Maximum size is 10MB.'
            });
        }
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
    if (error) {
        return res.status(400).json({
            success: false,
            error: error.message
        });
    }
    next();
});
exports.default = router;
