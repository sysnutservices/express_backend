import { Request, Response } from "express";
import multer from "multer";
import imagekit, { uploadToImageKit } from "../services/imagekit";

// Configure Multer (Memory Storage)
const storage = multer.memoryStorage();
export const galleryUpload = multer({
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
export const uploadGalleryImage = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                message: "No image uploaded",
            });
        }

        const upload = await uploadToImageKit(
            req.file,
            "/lapshark/gallery"
        );

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
    } catch (error) {
        console.error("GALLERY UPLOAD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload image",
        });
    }
};

/**
 * ==========================
 * Upload Multiple Images
 * POST /api/gallery/upload/multiple
 * ==========================
 */
export const uploadMultipleGalleryImages = async (req: Request, res: Response) => {
    try {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No files uploaded"
            });
        }

        const uploadPromises = files.map(file =>
            uploadToImageKit(file, "/lapshark/gallery")
        );

        const results = await Promise.all(uploadPromises);

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

    } catch (error) {
        console.error("GALLERY MULTI UPLOAD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload images",
        });
    }
};

/**
 * ==========================
 * Get Gallery Images
 * GET /api/gallery
 * ==========================
 */
export const getGalleryImages = async (_req: Request, res: Response) => {
    try {
        const files = await imagekit.listFiles({
            path: "/lapshark/gallery",
            limit: 100,
        });

        const images = files
            .filter((file: any) => file.type === "file")
            .map((file: any) => ({
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

    } catch (error) {
        console.error("GET GALLERY ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch gallery images",
        });
    }
};

/**
 * ==========================
 * Delete Image
 * DELETE /api/gallery/:fileId
 * ==========================
 */
export const deleteGalleryImage = async (req: Request, res: Response) => {
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

        await imagekit.deleteFile(fileId);

        return res.json({
            success: true,
            message: "Image deleted successfully",
            fileId,
        });
    } catch (error) {
        console.error("DELETE GALLERY ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete image",
        });
    }
};
