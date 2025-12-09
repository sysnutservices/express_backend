// routes/upload.ts
// Express.js TypeScript API for Image Upload (Local Storage)

import express, { Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
    destination: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
        cb(null, uploadDir);
    },
    filename: function (req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
        // Generate unique filename
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const ext = path.extname(file.originalname);
        cb(null, `${timestamp}-${randomString}${ext}`);
    }
});

// File filter - only allow images
const fileFilter = (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'));
    }
};

// Configure upload middleware
export const galleryUpload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// POST /api/upload - Upload single image
export const uploadSingleImage = (req: Request, res: Response) => {
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
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload file'
        });
    }
};

// POST /api/upload/multiple - Upload multiple images
export const uploadMultipleImages = (req: Request, res: Response) => {
    try {
        const files = req.files as Express.Multer.File[];

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
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload files'
        });
    }
};

// GET /api/images - Get list of all uploaded images
export const getImages = (req: Request, res: Response) => {
    try {
        if (!fs.existsSync(uploadDir)) {
            return res.json({ images: [] });
        }

        const files = fs.readdirSync(uploadDir);
        const images = files
            .filter(file => /\.(jpg|jpeg|png|gif|webp)$/i.test(file))
            .map(file => `/uploads/${file}`);

        res.json({
            success: true,
            images: images,
            count: images.length
        });
    } catch (error) {
        console.error('Error reading uploads directory:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to read images',
            images: []
        });
    }
};

// DELETE /api/delete-image - Delete an image
export const deleteImage = (req: Request, res: Response) => {
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
        const filepath = path.join(uploadDir, filename);

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                error: 'File not found'
            });
        }

        // Delete the file
        fs.unlinkSync(filepath);

        res.json({
            success: true,
            message: 'Image deleted successfully',
            deletedFile: filename
        });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete file'
        });
    }
};

// Error handling middleware for multer errors
router.use((error: any, req: Request, res: Response, next: NextFunction) => {
    if (error instanceof multer.MulterError) {
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

export default router;