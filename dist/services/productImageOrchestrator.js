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
exports.OrchestratorError = exports.DEFAULT_PROCESSING_MODE = void 0;
exports.createEcommerceImage = createEcommerceImage;
exports.budgetLimitMessage = budgetLimitMessage;
exports.recomposeVersion = recomposeVersion;
exports.publishProductImages = publishProductImages;
const mongoose_1 = require("mongoose");
const ProductImage_1 = __importDefault(require("../models/ProductImage"));
const Product_1 = __importDefault(require("../models/Product"));
const imagekit_1 = require("../services/imagekit");
const imageProcessing_1 = require("./imageProcessing");
const imageCostControl_1 = require("./imageCostControl");
const localSegmentation_1 = require("./localSegmentation");
const openaiClient_1 = require("./openaiClient");
const productImageEditor_1 = require("./productImage/productImageEditor");
const productImagePrompts_1 = require("./productImage/productImagePrompts");
exports.DEFAULT_PROCESSING_MODE = process.env.IMAGE_PROCESSING_MODE === "ai_edit" ? "ai_edit" : "catalogue_safe";
const CATALOGUE_SAFE_METHOD = "local-segmentation-v1";
const MAX_AI_EDIT_ATTEMPTS = 3; // 1 initial + 2 retries, only for transient failures
class OrchestratorError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.OrchestratorError = OrchestratorError;
function fetchImageBytes(url) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield fetch(url);
        if (!res.ok)
            throw new OrchestratorError("NO_ORIGINAL", `Could not fetch source image (${res.status})`);
        const buffer = Buffer.from(yield res.arrayBuffer());
        const mimeType = res.headers.get("content-type") || "image/jpeg";
        return { buffer, mimeType };
    });
}
function loadRoot(rootImageId) {
    return __awaiter(this, void 0, void 0, function* () {
        const root = yield ProductImage_1.default.findById(rootImageId);
        if (!root)
            throw new OrchestratorError("NOT_FOUND", "Image not found");
        if (root.rootImageId !== null)
            throw new OrchestratorError("NOT_A_ROOT", "Not an original image slot");
        if (!root.originalImageUrl || !root.originalImageHash) {
            throw new OrchestratorError("NO_ORIGINAL", "This image has no stored original and cannot be (re)processed");
        }
        return root;
    });
}
function nextVersionNumber(rootId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const lastVersion = yield ProductImage_1.default.findOne({ rootImageId: rootId }).sort({ version: -1 });
        return ((_a = lastVersion === null || lastVersion === void 0 ? void 0 : lastVersion.version) !== null && _a !== void 0 ? _a : 0) + 1;
    });
}
// Composes an already-segmented cutout into the transparent master, the
// derived white-background master, and the 2000/1200/500 variants, then
// uploads them all — shared so the Sharp compositing logic exists exactly
// once (createEcommerceImage calls this at generation time; recomposeVersion
// calls it again against the same cached cutout for Sharp-only settings
// changes, never re-running the ~1-2s ML segmentation step).
//
// brightnessMode "auto" (the default) computes a conservative, capped
// brightness/contrast correction FROM THIS PHOTO'S OWN HISTOGRAM (see
// analyzeExposure) and uses it as the enhancement default — but only when
// the caller hasn't already set brightness/contrast explicitly (an admin
// manually moving the sliders always wins; that's "Manual" mode, and needs
// no separate code path). "original" skips this analysis entirely.
function composeAndUpload(cutoutBuffer_1, viewType_1, settings_1, nameHintBase_1) {
    return __awaiter(this, arguments, void 0, function* (cutoutBuffer, viewType, settings, nameHintBase, brightnessMode = "auto") {
        let effectiveSettings = settings;
        if (brightnessMode === "auto" && (settings === null || settings === void 0 ? void 0 : settings.brightness) === undefined && (settings === null || settings === void 0 ? void 0 : settings.contrast) === undefined) {
            const exposure = yield (0, imageProcessing_1.analyzeExposure)(cutoutBuffer);
            if (exposure.needsCorrection) {
                effectiveSettings = Object.assign(Object.assign({}, settings), { brightness: exposure.brightness, contrast: exposure.contrast });
            }
        }
        const merged = (0, imageProcessing_1.resolveViewSettings)(viewType, effectiveSettings);
        const studioSettings = (0, imageProcessing_1.viewPresetToStudioSettings)(merged);
        // Transparent master first — the canonical artifact; the white ecommerce
        // version is a cheap flatten of THIS buffer, never a second independent
        // composite, so the two stay pixel-identical everywhere but the background.
        const transparentMaster = yield (0, imageProcessing_1.composeStudioImage)(cutoutBuffer, Object.assign(Object.assign({}, studioSettings), { background: "transparent", outputFormat: "png" }));
        const masterBuffer = yield (0, imageProcessing_1.flattenMasterToWhite)(transparentMaster, studioSettings.outputFormat, studioSettings.quality);
        const qualityWarning = yield (0, imageProcessing_1.validateMasterImage)(masterBuffer);
        const occupancyPercent = yield (0, imageProcessing_1.computeOccupancy)(masterBuffer);
        const variants = yield (0, imageProcessing_1.generateVariants)(masterBuffer);
        const nameHint = [nameHintBase, viewType.replace(/_/g, " ")].filter(Boolean).join(" ") || "laptop";
        const [transparentUpload, masterUpload, productUpload, thumbnailUpload] = yield Promise.all([
            (0, imagekit_1.uploadBufferToImageKit)(transparentMaster, "/lapshark/products/transparent", `${nameHint} transparent`),
            (0, imagekit_1.uploadBufferToImageKit)(variants.master.buffer, "/lapshark/products", nameHint),
            (0, imagekit_1.uploadBufferToImageKit)(variants.product.buffer, "/lapshark/products/variants", `${nameHint} product`),
            (0, imagekit_1.uploadBufferToImageKit)(variants.thumbnail.buffer, "/lapshark/products/variants", `${nameHint} thumbnail`),
        ]);
        return { merged, transparentUpload, masterUpload, productUpload, thumbnailUpload, qualityWarning, occupancyPercent };
    });
}
// The one entry point for both "Create Ecommerce Image" and "Reprocess" —
// always reads from the root's original, never from a previous version, so
// "always reprocess from original" is structural, not a rule two separate
// code paths have to remember to follow.
function createEcommerceImage(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const root = yield loadRoot(opts.rootImageId);
        const mode = opts.mode === "ai_edit" ? "ai_edit" : "catalogue_safe";
        const promptVersion = mode === "ai_edit" ? productImagePrompts_1.PRODUCT_IMAGE_PROMPT_VERSION : CATALOGUE_SAFE_METHOD;
        const hash = (0, imageCostControl_1.computeProcessingHash)({
            originalImageHash: root.originalImageHash,
            viewType: opts.viewType,
            promptVersion,
            processingConfigVersion: imageProcessing_1.PROCESSING_CONFIG_VERSION,
        });
        // Fingerprint reuse: identical original+viewType+mode+config was already
        // generated successfully — re-run only the Sharp step against the cached
        // cutout. Zero segmentation/OpenAI re-runs. Keyed on mode (via
        // promptVersion) so a catalogue_safe result is never mistaken for an
        // ai_edit one for the same viewType, or vice versa.
        const reusable = yield ProductImage_1.default.findOne({
            rootImageId: root._id,
            processingHash: hash,
            status: { $in: ["READY_FOR_REVIEW", "APPROVED", "PUBLISHED"] },
        }).sort({ createdAt: -1 });
        if (reusable) {
            return recomposeVersion(String(reusable._id), opts.settings);
        }
        const versionNumber = yield nextVersionNumber(root._id);
        const operation = versionNumber === 1 ? "create" : "reprocess";
        // Idempotency / duplicate-click guard: the partial unique index on
        // {rootImageId, processingHash, status:"PROCESSING"} makes a second rapid
        // click for the same fingerprint hit E11000 instead of starting a second
        // segmentation/OpenAI run — no queue system needed to dedupe in-flight work.
        let version;
        try {
            version = yield ProductImage_1.default.create({
                productId: root.productId,
                rootImageId: root._id,
                viewType: opts.viewType,
                status: "PROCESSING",
                version: versionNumber,
                originalImageUrl: root.originalImageUrl,
                originalImageHash: root.originalImageHash,
                processingHash: hash,
                promptVersion,
                processingConfigVersion: imageProcessing_1.PROCESSING_CONFIG_VERSION,
            });
        }
        catch (err) {
            if ((err === null || err === void 0 ? void 0 : err.code) === 11000) {
                const inFlight = yield ProductImage_1.default.findOne({ rootImageId: root._id, processingHash: hash, status: "PROCESSING" });
                if (inFlight)
                    return inFlight;
            }
            throw err;
        }
        try {
            const { buffer: originalBuffer, mimeType } = yield fetchImageBytes(root.originalImageUrl);
            let cutoutBuffer;
            let processingModel;
            if (mode === "ai_edit") {
                // Explicit, admin-selected opt-in only (never the silent default) —
                // accepts the risk that OpenAI alters product pixels. Costs money, so
                // this is the only branch that budget-checks/records OpenAI usage.
                const budgetCheck = yield (0, imageCostControl_1.checkBudgetAndLimits)((0, imageCostControl_1.estimateCost)(null).amountUsd);
                if (!budgetCheck.allowed) {
                    yield ProductImage_1.default.updateOne({ _id: version._id }, { status: "PROCESSING_FAILED", rejectionReason: budgetCheck.reason });
                    throw new OrchestratorError(budgetCheck.reason, budgetLimitMessage(budgetCheck.reason));
                }
                let edited = null;
                let lastError = null;
                for (let attempt = 1; attempt <= MAX_AI_EDIT_ATTEMPTS; attempt++) {
                    const startedAt = Date.now();
                    try {
                        edited = yield (0, productImageEditor_1.editProductImage)(originalBuffer, mimeType, opts.viewType);
                        const cost = (0, imageCostControl_1.estimateCost)(edited.usage);
                        yield (0, imageCostControl_1.recordUsage)({
                            productId: root.productId,
                            productImageId: root._id,
                            imageVersionId: version._id,
                            operation,
                            aiModel: "gpt-image-2",
                            originalImageHash: root.originalImageHash,
                            processingHash: hash,
                            promptVersion,
                            processingConfigVersion: imageProcessing_1.PROCESSING_CONFIG_VERSION,
                            status: "success",
                            inputUsage: edited.usage,
                            outputUsage: edited.usage,
                            totalUsage: edited.usage,
                            estimatedCost: cost.amountUsd,
                            estimatedCostIsApproximate: cost.approximate,
                            durationMs: Date.now() - startedAt,
                            initiatedBy: opts.initiatedBy ? new mongoose_1.Types.ObjectId(opts.initiatedBy) : null,
                        });
                        break;
                    }
                    catch (err) {
                        lastError = err;
                        // A geometry mismatch (product got rotated/reoriented) is model
                        // unpredictability on this one attempt, not invalid input or a
                        // content-policy rejection — worth a retry, same budget as a
                        // transient HTTP error.
                        const isGeometryMismatch = err instanceof productImageEditor_1.GeometryMismatchError;
                        const classified = (0, openaiClient_1.classifyOpenAIError)(err);
                        const transient = isGeometryMismatch || classified.transient;
                        yield (0, imageCostControl_1.recordUsage)({
                            productId: root.productId,
                            productImageId: root._id,
                            imageVersionId: version._id,
                            operation,
                            aiModel: "gpt-image-2",
                            originalImageHash: root.originalImageHash,
                            processingHash: hash,
                            promptVersion,
                            processingConfigVersion: imageProcessing_1.PROCESSING_CONFIG_VERSION,
                            status: transient ? "error_transient" : "error_permanent",
                            inputUsage: null,
                            outputUsage: null,
                            totalUsage: null,
                            estimatedCost: null,
                            estimatedCostIsApproximate: true,
                            durationMs: Date.now() - startedAt,
                            errorMessage: (isGeometryMismatch ? err.message : classified.message).slice(0, 500),
                            initiatedBy: opts.initiatedBy ? new mongoose_1.Types.ObjectId(opts.initiatedBy) : null,
                        });
                        if (!transient || attempt >= MAX_AI_EDIT_ATTEMPTS)
                            break;
                    }
                }
                if (!edited) {
                    yield ProductImage_1.default.updateOne({ _id: version._id }, { status: "PROCESSING_FAILED", rejectionReason: "AI image editing failed" });
                    throw new OrchestratorError("OPENAI_FAILED", lastError instanceof Error ? lastError.message : "AI image editing failed");
                }
                // Even here, alpha/bbox comes from real segmentation of OpenAI's
                // output — OpenAI's own transparency (if any) is never trusted.
                cutoutBuffer = yield (0, localSegmentation_1.removeBackgroundLocal)(edited.buffer);
                processingModel = `gpt-image-2+local-segmentation (${edited.imageType})`;
            }
            else {
                // The whole point of the default mode: segmentation runs directly on
                // the ORIGINAL photo's own pixels, never on a generative model's
                // regenerated output.
                cutoutBuffer = yield (0, localSegmentation_1.removeBackgroundLocal)(originalBuffer);
                processingModel = "local-segmentation";
            }
            // Reflection: detection only, always local/free, never a second OpenAI
            // call. In ai_edit mode the comprehensive prompt already asks OpenAI to
            // reduce glare as part of its one edit (see productImagePrompts.ts), so
            // this just flags whatever's left over; in catalogue_safe there was
            // never a correction step to begin with — a local, safe, general-purpose
            // glare-removal algorithm isn't a solved problem, so this mode only ever
            // detects and flags for manual review.
            let reflectionNote;
            const reflectionMode = (_a = opts.reflectionMode) !== null && _a !== void 0 ? _a : "auto";
            if (reflectionMode !== "off") {
                const reflection = yield (0, imageProcessing_1.analyzeReflection)(cutoutBuffer);
                if (reflection.detected) {
                    reflectionNote =
                        mode === "ai_edit"
                            ? `Possible residual reflection/glare detected (~${reflection.hotspotPercent}% of frame) after AI editing — review closely`
                            : `Possible reflection/glare detected (~${reflection.hotspotPercent}% of frame) — AI Edit mode attempts to reduce this, Catalogue Safe only flags it`;
                }
            }
            const cutoutUpload = yield (0, imagekit_1.uploadBufferToImageKit)(cutoutBuffer, "/lapshark/products/cutouts", `${opts.viewType} cutout`);
            const product = yield Product_1.default.findById(root.productId).select("title").lean();
            const { merged, transparentUpload, masterUpload, productUpload, thumbnailUpload, qualityWarning, occupancyPercent } = yield composeAndUpload(cutoutBuffer, opts.viewType, opts.settings, product === null || product === void 0 ? void 0 : product.title, (_b = opts.brightnessMode) !== null && _b !== void 0 ? _b : "auto");
            yield ProductImage_1.default.updateMany({ rootImageId: root._id, _id: { $ne: version._id }, isActive: true }, { isActive: false });
            version.status = "READY_FOR_REVIEW";
            version.qualityWarning = [qualityWarning, reflectionNote].filter(Boolean).join(" · ") || undefined;
            version.occupancyPercent = occupancyPercent;
            version.cutoutImageUrl = cutoutUpload.url;
            version.transparentMasterUrl = transparentUpload.url;
            version.masterImageUrl = masterUpload.url;
            version.productImageUrl = productUpload.url;
            version.thumbnailImageUrl = thumbnailUpload.url;
            version.processingModel = processingModel;
            version.processingSettings = merged;
            version.isActive = true;
            yield version.save();
            return version;
        }
        catch (err) {
            if (err instanceof OrchestratorError)
                throw err;
            yield ProductImage_1.default.updateOne({ _id: version._id, status: "PROCESSING" }, { status: "PROCESSING_FAILED", rejectionReason: err instanceof Error ? err.message.slice(0, 500) : "Processing failed" });
            throw err;
        }
    });
}
function budgetLimitMessage(reason) {
    switch (reason) {
        case "AI_DISABLED":
            return "AI image processing is temporarily disabled.";
        case "MONTHLY_BUDGET":
            return "Monthly image processing budget has been reached.";
        case "DAILY_LIMIT":
            return "Daily image processing limit reached, try again later.";
        case "HOURLY_LIMIT":
            return "Hourly image processing limit reached, try again later.";
        default:
            return "Image processing is currently unavailable.";
    }
}
// Sharp-only recompute against the cached cutout — no segmentation re-run,
// no new version number. Used both for fingerprint reuse and for the
// settings panel's live preview.
function recomposeVersion(versionId, settings) {
    return __awaiter(this, void 0, void 0, function* () {
        const version = yield ProductImage_1.default.findById(versionId);
        if (!version)
            throw new OrchestratorError("NOT_FOUND", "Image version not found");
        if (version.rootImageId === null)
            throw new OrchestratorError("NOT_A_ROOT", "Cannot recompose an original image slot");
        if (!version.cutoutImageUrl) {
            throw new OrchestratorError("NOT_RECOMPOSABLE", "This version has no cutout to recompose from yet");
        }
        const { buffer: cutoutBuffer } = yield fetchImageBytes(version.cutoutImageUrl);
        const { merged, transparentUpload, masterUpload, productUpload, thumbnailUpload, qualityWarning, occupancyPercent } = yield composeAndUpload(cutoutBuffer, version.viewType, settings, undefined);
        version.transparentMasterUrl = transparentUpload.url;
        version.masterImageUrl = masterUpload.url;
        version.productImageUrl = productUpload.url;
        version.thumbnailImageUrl = thumbnailUpload.url;
        version.processingSettings = merged;
        version.qualityWarning = qualityWarning !== null && qualityWarning !== void 0 ? qualityWarning : undefined;
        version.occupancyPercent = occupancyPercent;
        if (version.status === "PROCESSING_FAILED")
            version.status = "READY_FOR_REVIEW";
        yield version.save();
        return version;
    });
}
// Publishing reads only already-approved versions and never calls OpenAI —
// copies their URLs into Product.image/images, exactly mirroring how
// createProduct/updateProduct already accept pre-processed URLs today.
function publishProductImages(productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const roots = yield ProductImage_1.default.find({ productId, rootImageId: null }).sort({ sortOrder: 1 });
        if (roots.length === 0)
            throw new OrchestratorError("NOTHING_APPROVED", "No images to publish");
        const slots = [];
        for (const root of roots) {
            const approved = yield ProductImage_1.default.findOne({ rootImageId: root._id, status: "APPROVED" });
            if (approved)
                slots.push({ root, approved });
        }
        if (slots.length === 0)
            throw new OrchestratorError("NOTHING_APPROVED", "No approved images to publish");
        const primaryIndex = Math.max(0, slots.findIndex((s) => s.root.isPrimary));
        const primary = slots[primaryIndex];
        const rest = slots.filter((_, i) => i !== primaryIndex);
        const image = primary.approved.masterImageUrl;
        const images = rest.map((s) => s.approved.masterImageUrl).filter(Boolean);
        const now = new Date();
        for (const { root, approved } of slots) {
            // Supersede any prior PUBLISHED version under this root — never deleted.
            yield ProductImage_1.default.updateMany({ rootImageId: root._id, status: "PUBLISHED", _id: { $ne: approved._id } }, { status: "SUPERSEDED", isPublished: false });
            approved.status = "PUBLISHED";
            approved.isPublished = true;
            approved.publishedAt = now;
            yield approved.save();
        }
        yield Product_1.default.updateOne({ _id: productId }, { image, images });
        return { image, images };
    });
}
