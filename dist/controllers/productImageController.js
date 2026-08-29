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
exports.getUsageByProductHandler = exports.getUsageSummary = exports.publishProduct = exports.reorderProductImages = exports.deleteRootImage = exports.deleteVersion = exports.returnVersionToReview = exports.rejectVersion = exports.approveVersion = exports.updateVersionSettings = exports.processRootImage = exports.listProductImages = exports.uploadOriginal = exports.uploadOriginalMiddleware = void 0;
const sharp_1 = __importDefault(require("sharp"));
const ProductImage_1 = __importDefault(require("../models/ProductImage"));
const Product_1 = __importDefault(require("../models/Product"));
const productController_1 = require("./productController");
const imageSettingsValidation_1 = require("../utils/imageSettingsValidation");
const imagekit_1 = require("../services/imagekit");
const imageProcessing_1 = require("../services/imageProcessing");
const imageCostControl_1 = require("../services/imageCostControl");
const ImageProcessingUsage_1 = __importDefault(require("../models/ImageProcessingUsage"));
const productImageOrchestrator_1 = require("../services/productImageOrchestrator");
exports.uploadOriginalMiddleware = productController_1.upload.single("image");
function resolveViewType(raw) {
    return typeof raw === "string" && raw in imageProcessing_1.VIEW_PRESETS ? raw : "custom";
}
function errorResponse(res, err) {
    if (err instanceof productImageOrchestrator_1.OrchestratorError) {
        const { status, message } = mapOrchestratorError(err.code);
        return res.status(status).json({ message });
    }
    console.error("Product image workflow error:", err);
    const message = process.env.NODE_ENV === "production" ? undefined : err === null || err === void 0 ? void 0 : err.message;
    return res.status(500).json({ message: "Image processing failed", error: message });
}
function mapOrchestratorError(code) {
    switch (code) {
        case "NOT_FOUND":
            return { status: 404, message: "Image not found" };
        case "NOT_A_ROOT":
        case "NO_ORIGINAL":
        case "NOT_RECOMPOSABLE":
        case "NOTHING_APPROVED":
            return { status: 400, message: (code === "NOTHING_APPROVED") ? "No approved images to publish" : "This image cannot be processed" };
        case "AI_DISABLED":
            return { status: 503, message: "AI image processing is temporarily disabled." };
        case "MONTHLY_BUDGET":
            return { status: 402, message: "Monthly image processing budget has been reached." };
        case "DAILY_LIMIT":
        case "HOURLY_LIMIT":
            return { status: 429, message: "Image processing limit reached, please try again later." };
        case "OPENAI_FAILED":
            return { status: 502, message: "Image processing service is temporarily unavailable, please try again shortly." };
        default:
            return { status: 500, message: "Image processing failed" };
    }
}
// Saves the original photo as its own immutable ProductImage root — no
// OpenAI call happens here (Phase 21/25A #2). First image for a product
// becomes primary by default (Phase 32).
const uploadOriginal = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { productId } = req.params;
        const product = yield Product_1.default.findById(productId).select("_id");
        if (!product)
            return res.status(404).json({ message: "Product not found" });
        let buffer;
        let mimeType;
        if (req.file) {
            buffer = req.file.buffer;
            mimeType = req.file.mimetype;
        }
        else if (req.body.imageUrl) {
            const fetched = yield fetch(req.body.imageUrl);
            if (!fetched.ok)
                return res.status(400).json({ message: "Could not fetch source image" });
            buffer = Buffer.from(yield fetched.arrayBuffer());
            mimeType = fetched.headers.get("content-type") || "image/jpeg";
            if (!mimeType.startsWith("image/"))
                return res.status(400).json({ message: "imageUrl did not point to an image" });
        }
        else {
            return res.status(400).json({ message: "No image file or imageUrl provided" });
        }
        try {
            yield (0, sharp_1.default)(buffer).metadata();
        }
        catch (_a) {
            return res.status(400).json({ message: "Invalid or unsupported image" });
        }
        const originalImageHash = (0, imageCostControl_1.hashImageBuffer)(buffer);
        const uploaded = yield (0, imagekit_1.uploadBufferToImageKit)(buffer, "/lapshark/products/originals", req.body.nameHint);
        const existingCount = yield ProductImage_1.default.countDocuments({ productId, rootImageId: null });
        const root = yield ProductImage_1.default.create({
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
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.uploadOriginal = uploadOriginal;
// Lists every image slot for a product: real ProductImage roots + their
// versions, or (for products created before this feature existed) synthetic
// read-only slots derived from Product.image/images — see the ProductImage
// model comment for why these are never backfilled.
const listProductImages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { productId } = req.params;
        const roots = yield ProductImage_1.default.find({ productId, rootImageId: null }).sort({ sortOrder: 1 });
        if (roots.length === 0) {
            const product = yield Product_1.default.findById(productId).select("image images");
            if (!product)
                return res.status(404).json({ message: "Product not found" });
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
        const slots = yield Promise.all(roots.map((root) => __awaiter(void 0, void 0, void 0, function* () {
            const versions = yield ProductImage_1.default.find({ rootImageId: root._id }).sort({ version: -1 });
            const usageByVersion = yield ImageProcessingUsage_1.default.find({
                imageVersionId: { $in: versions.map((v) => v._id) },
                status: "success",
            }).sort({ createdAt: -1 });
            const usageMap = new Map(usageByVersion.map((u) => [String(u.imageVersionId), u]));
            return serializeRoot(root, versions.map((v) => ({ version: v, usage: usageMap.get(String(v._id)) })));
        })));
        res.json({ success: true, slots });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.listProductImages = listProductImages;
function serializeRoot(root, versions) {
    return {
        rootImageId: String(root._id),
        legacy: false,
        originalImageUrl: root.originalImageUrl,
        isPrimary: root.isPrimary,
        sortOrder: root.sortOrder,
        versions: versions.map(({ version, usage }) => {
            var _a, _b;
            return ({
                id: String(version._id),
                viewType: version.viewType,
                status: version.status,
                version: version.version,
                isActive: version.isActive,
                isApproved: version.isApproved,
                isPublished: version.isPublished,
                masterImageUrl: version.masterImageUrl,
                productImageUrl: version.productImageUrl,
                thumbnailImageUrl: version.thumbnailImageUrl,
                processingModel: version.processingModel,
                processingSettings: version.processingSettings,
                rejectionReason: version.rejectionReason,
                qualityWarning: version.qualityWarning,
                approvedAt: version.approvedAt,
                publishedAt: version.publishedAt,
                createdAt: version.createdAt,
                estimatedCost: (_a = usage === null || usage === void 0 ? void 0 : usage.estimatedCost) !== null && _a !== void 0 ? _a : null,
                estimatedCostIsApproximate: (_b = usage === null || usage === void 0 ? void 0 : usage.estimatedCostIsApproximate) !== null && _b !== void 0 ? _b : true,
            });
        }),
    };
}
// Shared by "Create Ecommerce Image" and "Reprocess" — see
// productImageOrchestrator.createEcommerceImage for why one endpoint for
// both is what guarantees reprocess-always-from-original.
const processRootImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const viewType = resolveViewType(req.body.viewType);
        const settings = (0, imageSettingsValidation_1.sanitizeSettings)(req.body.settings);
        const version = yield (0, productImageOrchestrator_1.createEcommerceImage)({
            rootImageId: req.params.rootImageId,
            viewType,
            settings,
            initiatedBy: ((_a = req.user) === null || _a === void 0 ? void 0 : _a._id) ? String(req.user._id) : null,
        });
        res.json({
            success: true,
            image: {
                id: String(version._id),
                status: version.status,
                viewType: version.viewType,
                masterUrl: version.masterImageUrl,
                processedUrl: version.productImageUrl,
                thumbnailUrl: version.thumbnailImageUrl,
                qualityWarning: (_b = version.qualityWarning) !== null && _b !== void 0 ? _b : null,
            },
        });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.processRootImage = processRootImage;
// Sharp-only recompute (scale/position/brightness/contrast/shadow/etc) — no
// OpenAI call, for the settings panel's live preview (Phase 25A #4/#6).
const updateVersionSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const settings = (0, imageSettingsValidation_1.sanitizeSettings)((_a = req.body.settings) !== null && _a !== void 0 ? _a : req.body);
        const version = yield (0, productImageOrchestrator_1.recomposeVersion)(req.params.versionId, settings);
        res.json({
            success: true,
            image: {
                id: String(version._id),
                status: version.status,
                masterUrl: version.masterImageUrl,
                processedUrl: version.productImageUrl,
                thumbnailUrl: version.thumbnailImageUrl,
                qualityWarning: (_b = version.qualityWarning) !== null && _b !== void 0 ? _b : null,
            },
        });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.updateVersionSettings = updateVersionSettings;
const approveVersion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const version = yield ProductImage_1.default.findById(req.params.versionId);
        if (!version || version.rootImageId === null)
            return res.status(404).json({ message: "Image version not found" });
        yield ProductImage_1.default.updateMany({ rootImageId: version.rootImageId, status: "APPROVED", _id: { $ne: version._id } }, { status: "SUPERSEDED" });
        version.status = "APPROVED";
        version.isApproved = true;
        version.approvedAt = new Date();
        yield version.save();
        res.json({ success: true });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.approveVersion = approveVersion;
const rejectVersion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const version = yield ProductImage_1.default.findById(req.params.versionId);
        if (!version || version.rootImageId === null)
            return res.status(404).json({ message: "Image version not found" });
        version.status = "REJECTED";
        version.isApproved = false;
        if (typeof req.body.reason === "string")
            version.rejectionReason = req.body.reason.slice(0, 500);
        yield version.save();
        res.json({ success: true });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.rejectVersion = rejectVersion;
const returnVersionToReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const version = yield ProductImage_1.default.findById(req.params.versionId);
        if (!version || version.rootImageId === null)
            return res.status(404).json({ message: "Image version not found" });
        if (version.status === "PUBLISHED")
            return res.status(400).json({ message: "A published image cannot be returned to review" });
        version.status = "READY_FOR_REVIEW";
        version.isApproved = false;
        version.approvedAt = undefined;
        yield version.save();
        res.json({ success: true });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.returnVersionToReview = returnVersionToReview;
// Removes a single AI attempt (not the whole slot) — for a generation the
// admin doesn't like, without losing the original or other versions under
// it. Same ImageKit-files-stay, blocked-while-published rules as
// deleteRootImage below.
const deleteVersion = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const version = yield ProductImage_1.default.findById(req.params.versionId);
        if (!version || version.rootImageId === null)
            return res.status(404).json({ message: "Image version not found" });
        if (version.isPublished) {
            return res.status(400).json({ message: "This image is published on the storefront — publish a replacement before deleting it." });
        }
        yield version.deleteOne();
        res.json({ success: true });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.deleteVersion = deleteVersion;
// Removes a slot (the original + every AI version under it) from the
// workflow entirely. Only the Mongo records go — the ImageKit files stay,
// same as SUPERSEDED versions elsewhere, since nothing else needs the
// storage back. Blocked while a version is live on the storefront so a
// stray click can't silently break the product page.
const deleteRootImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const root = yield ProductImage_1.default.findOne({ _id: req.params.rootImageId, rootImageId: null });
        if (!root)
            return res.status(404).json({ message: "Image not found" });
        const versions = yield ProductImage_1.default.find({ rootImageId: root._id });
        if (versions.some((v) => v.isPublished)) {
            return res.status(400).json({ message: "This image is published on the storefront — publish a replacement before deleting it." });
        }
        yield ProductImage_1.default.deleteMany({ _id: { $in: [root._id, ...versions.map((v) => v._id)] } });
        res.json({ success: true });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.deleteRootImage = deleteRootImage;
const reorderProductImages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { productId } = req.params;
        const order = req.body.order || [];
        if (order.some((o) => o.isPrimary)) {
            yield ProductImage_1.default.updateMany({ productId, rootImageId: null }, { isPrimary: false });
        }
        yield Promise.all(order.map((o) => ProductImage_1.default.updateOne({ _id: o.rootImageId, productId, rootImageId: null }, Object.assign({ sortOrder: o.sortOrder }, (o.isPrimary ? { isPrimary: true } : {})))));
        res.json({ success: true });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.reorderProductImages = reorderProductImages;
// Never calls OpenAI — reads only already-approved versions (Phase 25A #7/#25).
const publishProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield (0, productImageOrchestrator_1.publishProductImages)(req.params.productId);
        res.json(Object.assign({ success: true }, result));
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.publishProduct = publishProduct;
const getUsageSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const month = typeof req.query.month === "string" ? req.query.month : undefined;
        res.json({ success: true, summary: yield (0, imageCostControl_1.getMonthlyUsageSummary)(month) });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.getUsageSummary = getUsageSummary;
const getUsageByProductHandler = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        res.json({ success: true, products: yield (0, imageCostControl_1.getUsageByProduct)() });
    }
    catch (err) {
        errorResponse(res, err);
    }
});
exports.getUsageByProductHandler = getUsageByProductHandler;
