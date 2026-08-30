import { Request, Response } from "express";
import sharp from "sharp";
import ProductImage, { IProductImage } from "../models/ProductImage";
import Product from "../models/Product";
import { upload } from "./productController";
import { sanitizeSettings } from "../utils/imageSettingsValidation";
import { uploadBufferToImageKit } from "../services/imagekit";
import { VIEW_PRESETS, ProductViewType } from "../services/imageProcessing";
import { hashImageBuffer } from "../utils/imageHash";
import {
  createEcommerceImage,
  recomposeVersion,
  publishProductImages,
  OrchestratorError,
  OrchestratorErrorCode,
  BrightnessMode,
  ReflectionMode,
} from "../services/productImageOrchestrator";

export const uploadOriginalMiddleware = upload.single("image");

function resolveViewType(raw: unknown): ProductViewType {
  return typeof raw === "string" && raw in VIEW_PRESETS ? (raw as ProductViewType) : "custom";
}

function resolveBrightnessMode(raw: unknown): BrightnessMode {
  return raw === "original" ? "original" : "auto";
}

function resolveReflectionMode(raw: unknown): ReflectionMode {
  return raw === "off" || raw === "on" ? raw : "auto";
}

function errorResponse(res: Response, err: unknown) {
  if (err instanceof OrchestratorError) {
    const { status, message } = mapOrchestratorError(err.code);
    return res.status(status).json({ message });
  }
  console.error("Product image workflow error:", err);
  const message = process.env.NODE_ENV === "production" ? undefined : (err as any)?.message;
  return res.status(500).json({ message: "Image processing failed", error: message });
}

function mapOrchestratorError(code: OrchestratorErrorCode): { status: number; message: string } {
  switch (code) {
    case "NOT_FOUND":
      return { status: 404, message: "Image not found" };
    case "NOT_A_ROOT":
    case "NO_ORIGINAL":
    case "NOT_RECOMPOSABLE":
    case "NOTHING_APPROVED":
      return { status: 400, message: (code === "NOTHING_APPROVED") ? "No approved images to publish" : "This image cannot be processed" };
    default:
      return { status: 500, message: "Image processing failed" };
  }
}

// Saves the original photo as its own immutable ProductImage root — no
// OpenAI call happens here (Phase 21/25A #2). First image for a product
// becomes primary by default (Phase 32).
export const uploadOriginal = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const product = await Product.findById(productId).select("_id");
    if (!product) return res.status(404).json({ message: "Product not found" });

    let buffer: Buffer;
    let mimeType: string;
    if (req.file) {
      buffer = req.file.buffer;
      mimeType = req.file.mimetype;
    } else if (req.body.imageUrl) {
      const fetched = await fetch(req.body.imageUrl);
      if (!fetched.ok) return res.status(400).json({ message: "Could not fetch source image" });
      buffer = Buffer.from(await fetched.arrayBuffer());
      mimeType = fetched.headers.get("content-type") || "image/jpeg";
      if (!mimeType.startsWith("image/")) return res.status(400).json({ message: "imageUrl did not point to an image" });
    } else {
      return res.status(400).json({ message: "No image file or imageUrl provided" });
    }

    try {
      await sharp(buffer).metadata();
    } catch {
      return res.status(400).json({ message: "Invalid or unsupported image" });
    }

    const originalImageHash = hashImageBuffer(buffer);
    const uploaded = await uploadBufferToImageKit(buffer, "/lapshark/products/originals", req.body.nameHint);

    const existingCount = await ProductImage.countDocuments({ productId, rootImageId: null });
    const root = await ProductImage.create({
      productId,
      rootImageId: null,
      status: "UPLOADED",
      version: 0,
      isPrimary: existingCount === 0,
      sortOrder: existingCount,
      originalImageUrl: uploaded.url,
      originalImageHash,
    });

    res.json({ success: true, image: serializeRoot(root, []) });
  } catch (err) {
    errorResponse(res, err);
  }
};

// Lists every image slot for a product: real ProductImage roots + their
// versions, or (for products created before this feature existed) synthetic
// read-only slots derived from Product.image/images — see the ProductImage
// model comment for why these are never backfilled.
export const listProductImages = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const roots = await ProductImage.find({ productId, rootImageId: null }).sort({ sortOrder: 1 });

    if (roots.length === 0) {
      const product = await Product.findById(productId).select("image images");
      if (!product) return res.status(404).json({ message: "Product not found" });
      const legacyUrls = [product.image, ...(product.images || [])].filter(Boolean);
      return res.json({
        success: true,
        slots: legacyUrls.map((url, i) => ({
          rootImageId: `legacy-${i}`,
          legacy: true,
          originalImageUrl: null,
          isPrimary: i === 0,
          sortOrder: i,
          versions: [
            {
              id: `legacy-${i}`,
              status: "PUBLISHED",
              isApproved: true,
              isPublished: true,
              masterImageUrl: url,
              productImageUrl: url,
              thumbnailImageUrl: url,
            },
          ],
        })),
      });
    }

    const slots = await Promise.all(
      roots.map(async (root) => {
        const versions = await ProductImage.find({ rootImageId: root._id }).sort({ version: -1 });
        return serializeRoot(root, versions);
      })
    );

    res.json({ success: true, slots });
  } catch (err) {
    errorResponse(res, err);
  }
};

function serializeRoot(root: IProductImage, versions: IProductImage[]) {
  return {
    rootImageId: String(root._id),
    legacy: false,
    originalImageUrl: root.originalImageUrl,
    isPrimary: root.isPrimary,
    sortOrder: root.sortOrder,
    versions: versions.map((version) => ({
      id: String(version._id),
      viewType: version.viewType,
      status: version.status,
      version: version.version,
      isActive: version.isActive,
      isApproved: version.isApproved,
      isPublished: version.isPublished,
      transparentMasterUrl: version.transparentMasterUrl,
      masterImageUrl: version.masterImageUrl,
      productImageUrl: version.productImageUrl,
      thumbnailImageUrl: version.thumbnailImageUrl,
      processingModel: version.processingModel,
      processingSettings: version.processingSettings,
      rejectionReason: version.rejectionReason,
      qualityWarning: version.qualityWarning,
      occupancyPercent: version.occupancyPercent,
      approvedAt: version.approvedAt,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
    })),
  };
}

// Shared by "Create Ecommerce Image" and "Reprocess" — see
// productImageOrchestrator.createEcommerceImage for why one endpoint for
// both is what guarantees reprocess-always-from-original.
export const processRootImage = async (req: Request, res: Response) => {
  try {
    const viewType = resolveViewType(req.body.viewType);
    const settings = sanitizeSettings(req.body.settings);
    const brightnessMode = resolveBrightnessMode(req.body.brightnessMode);
    const reflectionMode = resolveReflectionMode(req.body.reflectionMode);
    const version = await createEcommerceImage({
      rootImageId: req.params.rootImageId,
      viewType,
      settings,
      brightnessMode,
      reflectionMode,
      initiatedBy: (req as any).user?._id ? String((req as any).user._id) : null,
    });
    res.json({
      success: true,
      image: {
        id: String(version._id),
        status: version.status,
        viewType: version.viewType,
        processingModel: version.processingModel,
        transparentUrl: version.transparentMasterUrl,
        masterUrl: version.masterImageUrl,
        processedUrl: version.productImageUrl,
        thumbnailUrl: version.thumbnailImageUrl,
        qualityWarning: version.qualityWarning ?? null,
        occupancyPercent: version.occupancyPercent ?? null,
      },
    });
  } catch (err) {
    errorResponse(res, err);
  }
};

// Sharp-only recompute (scale/position/brightness/contrast/shadow/etc) — no
// OpenAI call, for the settings panel's live preview (Phase 25A #4/#6).
export const updateVersionSettings = async (req: Request, res: Response) => {
  try {
    const settings = sanitizeSettings(req.body.settings ?? req.body);
    const version = await recomposeVersion(req.params.versionId, settings);
    res.json({
      success: true,
      image: {
        id: String(version._id),
        status: version.status,
        transparentUrl: version.transparentMasterUrl,
        masterUrl: version.masterImageUrl,
        processedUrl: version.productImageUrl,
        thumbnailUrl: version.thumbnailImageUrl,
        qualityWarning: version.qualityWarning ?? null,
        occupancyPercent: version.occupancyPercent ?? null,
      },
    });
  } catch (err) {
    errorResponse(res, err);
  }
};

export const approveVersion = async (req: Request, res: Response) => {
  try {
    const version = await ProductImage.findById(req.params.versionId);
    if (!version || version.rootImageId === null) return res.status(404).json({ message: "Image version not found" });
    await ProductImage.updateMany(
      { rootImageId: version.rootImageId, status: "APPROVED", _id: { $ne: version._id } },
      { status: "SUPERSEDED" }
    );
    version.status = "APPROVED";
    version.isApproved = true;
    version.approvedAt = new Date();
    await version.save();
    res.json({ success: true });
  } catch (err) {
    errorResponse(res, err);
  }
};

export const rejectVersion = async (req: Request, res: Response) => {
  try {
    const version = await ProductImage.findById(req.params.versionId);
    if (!version || version.rootImageId === null) return res.status(404).json({ message: "Image version not found" });
    version.status = "REJECTED";
    version.isApproved = false;
    if (typeof req.body.reason === "string") version.rejectionReason = req.body.reason.slice(0, 500);
    await version.save();
    res.json({ success: true });
  } catch (err) {
    errorResponse(res, err);
  }
};

export const returnVersionToReview = async (req: Request, res: Response) => {
  try {
    const version = await ProductImage.findById(req.params.versionId);
    if (!version || version.rootImageId === null) return res.status(404).json({ message: "Image version not found" });
    if (version.status === "PUBLISHED") return res.status(400).json({ message: "A published image cannot be returned to review" });
    version.status = "READY_FOR_REVIEW";
    version.isApproved = false;
    version.approvedAt = undefined;
    await version.save();
    res.json({ success: true });
  } catch (err) {
    errorResponse(res, err);
  }
};

// Removes a single AI attempt (not the whole slot) — for a generation the
// admin doesn't like, without losing the original or other versions under
// it. Same ImageKit-files-stay, blocked-while-published rules as
// deleteRootImage below.
export const deleteVersion = async (req: Request, res: Response) => {
  try {
    const version = await ProductImage.findById(req.params.versionId);
    if (!version || version.rootImageId === null) return res.status(404).json({ message: "Image version not found" });
    if (version.isPublished) {
      return res.status(400).json({ message: "This image is published on the storefront — publish a replacement before deleting it." });
    }
    await version.deleteOne();
    res.json({ success: true });
  } catch (err) {
    errorResponse(res, err);
  }
};

// Removes a slot (the original + every AI version under it) from the
// workflow entirely. Only the Mongo records go — the ImageKit files stay,
// same as SUPERSEDED versions elsewhere, since nothing else needs the
// storage back. Blocked while a version is live on the storefront so a
// stray click can't silently break the product page.
export const deleteRootImage = async (req: Request, res: Response) => {
  try {
    const root = await ProductImage.findOne({ _id: req.params.rootImageId, rootImageId: null });
    if (!root) return res.status(404).json({ message: "Image not found" });
    const versions = await ProductImage.find({ rootImageId: root._id });
    if (versions.some((v) => v.isPublished)) {
      return res.status(400).json({ message: "This image is published on the storefront — publish a replacement before deleting it." });
    }
    await ProductImage.deleteMany({ _id: { $in: [root._id, ...versions.map((v) => v._id)] } });
    res.json({ success: true });
  } catch (err) {
    errorResponse(res, err);
  }
};

export const reorderProductImages = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const order: { rootImageId: string; sortOrder: number; isPrimary?: boolean }[] = req.body.order || [];
    if (order.some((o) => o.isPrimary)) {
      await ProductImage.updateMany({ productId, rootImageId: null }, { isPrimary: false });
    }
    await Promise.all(
      order.map((o) =>
        ProductImage.updateOne(
          { _id: o.rootImageId, productId, rootImageId: null },
          { sortOrder: o.sortOrder, ...(o.isPrimary ? { isPrimary: true } : {}) }
        )
      )
    );
    res.json({ success: true });
  } catch (err) {
    errorResponse(res, err);
  }
};

// Never calls OpenAI — reads only already-approved versions (Phase 25A #7/#25).
export const publishProduct = async (req: Request, res: Response) => {
  try {
    const result = await publishProductImages(req.params.productId);
    res.json({ success: true, ...result });
  } catch (err) {
    errorResponse(res, err);
  }
};

