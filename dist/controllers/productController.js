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
exports.processImage = exports.deleteProduct = exports.updateProduct = exports.createProduct = exports.getProductBySlug = exports.getProductById = exports.getProducts = exports.upload = void 0;
const Product_1 = __importDefault(require("../models/Product"));
const slugify_1 = __importDefault(require("slugify"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const imagekit_1 = require("../services/imagekit");
const sharp_1 = __importDefault(require("sharp"));
const imageProcessing_1 = require("../services/imageProcessing");
const imageSettingsValidation_1 = require("../utils/imageSettingsValidation");
const openaiImageService_1 = require("../services/openaiImageService");
const imageCostControl_1 = require("../services/imageCostControl");
const localSegmentation_1 = require("../services/localSegmentation");
// Configure multer storage
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const uploadPath = path.join(__dirname, '../../uploads/products');
//     if (!fs.existsSync(uploadPath)) {
//       fs.mkdirSync(uploadPath, { recursive: true });
//     }
//     cb(null, uploadPath);
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
        cb(null, true);
    }
    else {
        cb(new Error('Only image files are allowed!'));
    }
};
exports.upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter,
});
const getProducts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const products = yield Product_1.default.find({});
        res.json(products);
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.getProducts = getProducts;
const getProductById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const product = yield Product_1.default.findById(req.params.id);
        if (product) {
            res.json(product);
        }
        else {
            res.status(404).json({ message: 'Product not found' });
        }
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.getProductById = getProductById;
const getProductBySlug = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log("Slug received:", req.params.slug);
        const product = yield Product_1.default.findOne({ slug: req.params.slug });
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        res.json(product);
    }
    catch (error) {
        console.error("Actual Error:", error);
        res.status(400).json({ message: "Server Error", error: error.message });
    }
});
exports.getProductBySlug = getProductBySlug;
// A product without a slug has no reachable URL and is dropped from the
// sitemap, so one is always generated. Suffixes on collision because slug is a
// unique index — a duplicate title would otherwise throw E11000 on save.
function uniqueSlug(title, excludeId) {
    return __awaiter(this, void 0, void 0, function* () {
        // Product titles are pipe-separated spec strings. slugify's strict mode maps
        // "|" to the word "or", producing dell-5400-or-intel-i5-or-8gb, so the
        // separators are stripped to spaces first.
        const cleaned = String(title || 'product').replace(/[|/\\]+/g, ' ');
        const base = (0, slugify_1.default)(cleaned, { lower: true, strict: true }) || 'product';
        let slug = base;
        let n = 2;
        while (yield Product_1.default.exists(Object.assign({ slug }, (excludeId ? { _id: { $ne: excludeId } } : {})))) {
            slug = `${base}-${n++}`;
        }
        return slug;
    });
}
const createProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const files = req.files;
        // Get main image
        let mainImage = "";
        let galleryImages = [];
        // Product title doubles as the image filename hint below (e.g.
        // "dell-latitude-5400-i5-8gb.jpg" instead of "gallery-<random>.jpg").
        const titleHint = String(req.body.title || 'product').replace(/[|/\\]+/g, ' ');
        // MAIN IMAGE UPLOAD
        if ((_a = files === null || files === void 0 ? void 0 : files.image) === null || _a === void 0 ? void 0 : _a[0]) {
            const uploadResult = yield (0, imagekit_1.uploadToImageKit)(files.image[0], "/lapshark/products", titleHint);
            mainImage = uploadResult.url;
        }
        // GALLERY IMAGE UPLOAD
        if ((_b = files === null || files === void 0 ? void 0 : files.images) === null || _b === void 0 ? void 0 : _b.length) {
            const uploadResults = yield Promise.all(files.images.map((img, i) => (0, imagekit_1.uploadToImageKit)(img, "/lapshark/products/gallery", `${titleHint} ${i + 1}`)));
            galleryImages = uploadResults.map(res => res.url);
        }
        // URL-based images — used by the CRM's Product Sync Service (already
        // hosted elsewhere) and by the admin form's auto background-removal step
        // (already hosted on ImageKit by the time Save runs). Main image: file
        // wins if both are present. Gallery: appended alongside any uploaded
        // files rather than replacing them, since a save can legitimately mix
        // processed URLs with raw-file fallbacks for images that failed to process.
        if (!mainImage && req.body.imageUrl) {
            const uploaded = yield (0, imagekit_1.uploadUrlToImageKit)(req.body.imageUrl, "/lapshark/products", titleHint);
            mainImage = uploaded.url;
        }
        if (req.body.imageUrls) {
            const urls = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
            const uploadResults = yield Promise.all(urls.map((u, i) => (0, imagekit_1.uploadUrlToImageKit)(u, "/lapshark/products/gallery", `${titleHint} ${i + 1}`)));
            galleryImages = [...galleryImages, ...uploadResults.map((res) => res.url)];
        }
        // Parse JSON data from form-data
        const productData = Object.assign(Object.assign({}, req.body), { price: Number(req.body.price), discountPercent: Number(req.body.discountPercent || 0), stock: Number(req.body.stock), rating: Number(req.body.rating || 0), reviews: Number(req.body.reviews || 0), finalPrice: Number(req.body.finalPrice), weightKg: req.body.weightKg !== undefined ? Number(req.body.weightKg) : undefined, lengthCm: req.body.lengthCm !== undefined ? Number(req.body.lengthCm) : undefined, widthCm: req.body.widthCm !== undefined ? Number(req.body.widthCm) : undefined, heightCm: req.body.heightCm !== undefined ? Number(req.body.heightCm) : undefined, image: mainImage, images: galleryImages, specs: req.body.specs ? JSON.parse(req.body.specs) : {}, configOptions: req.body.configOptions ? JSON.parse(req.body.configOptions) : undefined, isNewItem: req.body.isNewItem === 'true', isTrending: req.body.isTrending === 'true', isBestDeal: req.body.isBestDeal === 'true', useCases: req.body.useCases ? JSON.parse(req.body.useCases) : [], tags: req.body.tags ? JSON.parse(req.body.tags) : [], performanceTier: req.body.performanceTier || undefined, qualityReport: req.body.qualityReport ? JSON.parse(req.body.qualityReport) : undefined });
        // Generated from the title when the admin form leaves it blank.
        if (!productData.slug || !String(productData.slug).trim()) {
            productData.slug = yield uniqueSlug(productData.title);
        }
        else {
            productData.slug = yield uniqueSlug(String(productData.slug));
        }
        const product = new Product_1.default(productData);
        const createdProduct = yield product.save();
        res.status(201).json(createdProduct);
    }
    catch (error) {
        console.error('Error creating product:', error);
        res.status(400).json({ message: 'Invalid product data', error: error.message });
    }
});
exports.createProduct = createProduct;
const updateProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const product = yield Product_1.default.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: "Product not found" });
        }
        const files = req.files;
        const titleHint = String(req.body.title || product.title || 'product').replace(/[|/\\]+/g, ' ');
        //
        // 1️⃣ MAIN IMAGE (Upload to ImageKit)
        //
        if ((_a = files === null || files === void 0 ? void 0 : files.image) === null || _a === void 0 ? void 0 : _a[0]) {
            const uploadResult = yield (0, imagekit_1.uploadToImageKit)(files.image[0], "/lapshark/products", titleHint);
            product.image = uploadResult.url;
        }
        else if (req.body.imageUrl) {
            // URL-based main image — same CRM sync use case as createProduct above.
            const uploaded = yield (0, imagekit_1.uploadUrlToImageKit)(req.body.imageUrl, "/lapshark/products", titleHint);
            product.image = uploaded.url;
        }
        //
        // 2️⃣ GALLERY IMAGES
        //
        let galleryImages = product.images || [];
        // Frontend sends remaining old images
        if (req.body.existingImages) {
            try {
                const parsed = typeof req.body.existingImages === 'string'
                    ? JSON.parse(req.body.existingImages)
                    : req.body.existingImages;
                if (Array.isArray(parsed)) {
                    galleryImages = parsed;
                }
            }
            catch (err) {
                console.error("❌ Invalid existingImages JSON", err);
            }
        }
        // Upload NEW gallery images to ImageKit. These two sources (freshly
        // uploaded files vs. already-hosted URLs, e.g. from the processed-image
        // flow or the CRM sync) can both be present in the same request, so both
        // are appended rather than one gating the other.
        if ((_b = files === null || files === void 0 ? void 0 : files.images) === null || _b === void 0 ? void 0 : _b.length) {
            const uploadedGallery = yield Promise.all(files.images.map((file, i) => (0, imagekit_1.uploadToImageKit)(file, "/lapshark/products/gallery", `${titleHint} ${galleryImages.length + i + 1}`)));
            galleryImages = [...galleryImages, ...uploadedGallery.map(r => r.url)];
        }
        if (req.body.imageUrls) {
            // URL-based gallery images — same CRM sync use case as createProduct.
            const urls = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
            const uploadedGallery = yield Promise.all(urls.map((u, i) => (0, imagekit_1.uploadUrlToImageKit)(u, "/lapshark/products/gallery", `${titleHint} ${galleryImages.length + i + 1}`)));
            galleryImages = [...galleryImages, ...uploadedGallery.map((r) => r.url)];
        }
        product.images = galleryImages;
        //
        // 3️⃣ Parse JSON fields and ASSIGN them back to product
        //
        if (typeof req.body.specs === "string") {
            try {
                product.specs = JSON.parse(req.body.specs);
            }
            catch (err) {
                console.error("Invalid specs JSON", err);
            }
        }
        else if (typeof req.body.specs === "object") {
            product.specs = req.body.specs;
        }
        if (req.body.configOptions) {
            try {
                product.configOptions = JSON.parse(req.body.configOptions);
            }
            catch (err) {
                console.error("Invalid configOptions JSON", err);
            }
        }
        //
        // 4️⃣ Update text & numeric fields
        //
        if (req.body.title !== undefined)
            product.title = req.body.title;
        if (req.body.description !== undefined)
            product.description = req.body.description;
        if (req.body.brand !== undefined)
            product.brand = req.body.brand;
        if (req.body.category !== undefined)
            product.category = req.body.category;
        if (req.body.condition !== undefined)
            product.condition = req.body.condition;
        if (req.body.useCases !== undefined)
            product.useCases = JSON.parse(req.body.useCases);
        if (req.body.tags !== undefined)
            product.tags = JSON.parse(req.body.tags);
        if (req.body.performanceTier !== undefined)
            product.performanceTier = (req.body.performanceTier || undefined);
        if (req.body.qualityReport !== undefined)
            product.qualityReport = JSON.parse(req.body.qualityReport);
        if (req.body.productId !== undefined)
            product.productId = req.body.productId;
        if (req.body.slug !== undefined)
            product.slug = req.body.slug;
        // Backfill only. An existing slug is never regenerated on edit: changing a
        // live URL breaks inbound links and loses whatever ranking it has earned.
        if (!product.slug || !String(product.slug).trim()) {
            product.slug = yield uniqueSlug(product.title, String(product._id));
        }
        if (req.body.price !== undefined)
            product.price = Number(req.body.price);
        if (req.body.discountPercent !== undefined)
            product.discountPercent = Number(req.body.discountPercent);
        if (req.body.stock !== undefined)
            product.stock = Number(req.body.stock);
        if (req.body.finalPrice !== undefined)
            product.finalPrice = Number(req.body.finalPrice);
        if (req.body.rating !== undefined)
            product.rating = Number(req.body.rating);
        if (req.body.reviews !== undefined)
            product.reviews = Number(req.body.reviews);
        if (req.body.weightKg !== undefined)
            product.weightKg = Number(req.body.weightKg);
        if (req.body.lengthCm !== undefined)
            product.lengthCm = Number(req.body.lengthCm);
        if (req.body.widthCm !== undefined)
            product.widthCm = Number(req.body.widthCm);
        if (req.body.heightCm !== undefined)
            product.heightCm = Number(req.body.heightCm);
        //
        // 5️⃣ Boolean fields
        //
        if (req.body.isNewItem !== undefined)
            product.isNewItem = req.body.isNewItem === "true";
        if (req.body.isTrending !== undefined)
            product.isTrending = req.body.isTrending === "true";
        if (req.body.isBestDeal !== undefined)
            product.isBestDeal = req.body.isBestDeal === "true";
        //
        // 6️⃣ Save updated product
        //
        const updated = yield product.save();
        console.log("✅ Product updated:", updated._id);
        res.json(updated);
    }
    catch (error) {
        console.error("❌ Error updating product:", error);
        res.status(400).json({
            message: "Error updating product",
            error: error.message,
        });
    }
});
exports.updateProduct = updateProduct;
const deleteProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const product = yield Product_1.default.findById(req.params.id);
        if (product) {
            // Delete main image
            if (product.image && product.image.startsWith('/uploads/')) {
                const imagePath = path_1.default.join(__dirname, '../..', product.image);
                if (fs_1.default.existsSync(imagePath)) {
                    fs_1.default.unlinkSync(imagePath);
                }
            }
            // Delete gallery images
            if (product.images && product.images.length > 0) {
                product.images.forEach(img => {
                    if (img.startsWith('/uploads/')) {
                        const imgPath = path_1.default.join(__dirname, '../..', img);
                        if (fs_1.default.existsSync(imgPath)) {
                            fs_1.default.unlinkSync(imgPath);
                        }
                    }
                });
            }
            yield product.deleteOne();
            res.json({ message: 'Product removed' });
        }
        else {
            res.status(404).json({ message: 'Product not found' });
        }
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.deleteProduct = deleteProduct;
// Runs a picked file (or an already-hosted image, for reprocessing) through
// OpenAI GPT Image 2 + view-preset-driven Sharp compositing, then uploads
// the result to ImageKit. Called by the admin form the instant an image is
// picked, before the product itself is saved — the returned URL is what
// createProduct/updateProduct receive via imageUrl/imageUrls.
//
// No productId/ProductImage exists yet at this point in the flow, so usage
// is recorded with null product references (still counts toward the
// budget/rate limits — see ImageProcessingUsage's productId comment) and
// there's no fingerprint-reuse or version history here, only a single
// attempt per call; the existing admin form's own "Retry" button already
// covers manual retry on failure.
const processImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        let inputBuffer;
        let mimeType;
        if (req.file) {
            inputBuffer = req.file.buffer;
            mimeType = req.file.mimetype;
        }
        else if (req.body.imageUrl) {
            const fetched = yield fetch(req.body.imageUrl);
            if (!fetched.ok)
                throw new Error(`Could not fetch source image (${fetched.status})`);
            inputBuffer = Buffer.from(yield fetched.arrayBuffer());
            mimeType = fetched.headers.get('content-type') || 'image/jpeg';
            if (!mimeType.startsWith('image/')) {
                return res.status(400).json({ message: 'imageUrl did not point to an image' });
            }
        }
        else {
            return res.status(400).json({ message: 'No image file or imageUrl provided' });
        }
        try {
            yield (0, sharp_1.default)(inputBuffer).metadata();
        }
        catch (_c) {
            return res.status(400).json({ message: 'Invalid or unsupported image' });
        }
        const viewType = req.body.viewType in imageProcessing_1.VIEW_PRESETS ? req.body.viewType : 'custom';
        const settings = (0, imageSettingsValidation_1.sanitizeSettings)(req.body.settings);
        const budgetCheck = yield (0, imageCostControl_1.checkBudgetAndLimits)((0, imageCostControl_1.estimateCost)(null).amountUsd);
        if (!budgetCheck.allowed) {
            const status = budgetCheck.reason === 'AI_DISABLED' ? 503 : budgetCheck.reason === 'MONTHLY_BUDGET' ? 402 : 429;
            const messages = {
                AI_DISABLED: 'AI image processing is temporarily disabled.',
                MONTHLY_BUDGET: 'Monthly image processing budget has been reached.',
                DAILY_LIMIT: 'Daily image processing limit reached, try again later.',
                HOURLY_LIMIT: 'Hourly image processing limit reached, try again later.',
            };
            return res.status(status).json({ message: messages[budgetCheck.reason] });
        }
        const prompt = (0, openaiImageService_1.buildLapsharkImagePrompt)({ viewType });
        const initiatedBy = (_b = (_a = req.user) === null || _a === void 0 ? void 0 : _a._id) !== null && _b !== void 0 ? _b : null;
        const attemptStart = Date.now();
        let edited;
        try {
            edited = yield (0, openaiImageService_1.generateEcommerceEdit)(inputBuffer, mimeType, prompt);
            const cost = (0, imageCostControl_1.estimateCost)(edited.usage);
            yield (0, imageCostControl_1.recordUsage)({
                productId: null,
                productImageId: null,
                imageVersionId: null,
                operation: 'create',
                aiModel: 'gpt-image-2',
                originalImageHash: null,
                processingHash: null,
                promptVersion: openaiImageService_1.IMAGE_PROMPT_VERSION,
                processingConfigVersion: imageProcessing_1.PROCESSING_CONFIG_VERSION,
                status: 'success',
                inputUsage: edited.usage,
                outputUsage: edited.usage,
                totalUsage: edited.usage,
                estimatedCost: cost.amountUsd,
                estimatedCostIsApproximate: cost.approximate,
                durationMs: Date.now() - attemptStart,
                initiatedBy,
            });
        }
        catch (err) {
            const classified = (0, openaiImageService_1.classifyOpenAIError)(err);
            yield (0, imageCostControl_1.recordUsage)({
                productId: null,
                productImageId: null,
                imageVersionId: null,
                operation: 'create',
                aiModel: 'gpt-image-2',
                originalImageHash: null,
                processingHash: null,
                promptVersion: openaiImageService_1.IMAGE_PROMPT_VERSION,
                processingConfigVersion: imageProcessing_1.PROCESSING_CONFIG_VERSION,
                status: classified.transient ? 'error_transient' : 'error_permanent',
                inputUsage: null,
                outputUsage: null,
                totalUsage: null,
                estimatedCost: null,
                estimatedCostIsApproximate: true,
                durationMs: Date.now() - attemptStart,
                errorMessage: classified.message.slice(0, 500),
                initiatedBy,
            });
            throw new Error('AI image editing failed');
        }
        // Tight, robust bounding-box crop (IS-Net) before composition — OpenAI's
        // edit doesn't determine final geometry, Sharp does, from this bbox.
        const cutoutBuffer = yield (0, localSegmentation_1.removeBackgroundLocal)(edited.buffer);
        const merged = (0, imageProcessing_1.resolveViewSettings)(viewType, settings);
        const studioSettings = (0, imageProcessing_1.viewPresetToStudioSettings)(merged);
        const masterBuffer = yield (0, imageProcessing_1.composeStudioImage)(cutoutBuffer, studioSettings);
        const variants = yield (0, imageProcessing_1.generateVariants)(masterBuffer);
        // No product title exists yet at this stage (image is processed before
        // Save) — fall back to the view type, still far more descriptive than a
        // random id. The admin form can pass `title` here once it's known.
        const nameHint = [req.body.title, viewType !== 'custom' ? viewType.replace(/_/g, ' ') : ''].filter(Boolean).join(' ') || 'laptop';
        const [masterUpload, productUpload, thumbnailUpload] = yield Promise.all([
            (0, imagekit_1.uploadBufferToImageKit)(variants.master.buffer, '/lapshark/products', nameHint),
            (0, imagekit_1.uploadBufferToImageKit)(variants.product.buffer, '/lapshark/products/variants', `${nameHint} product`),
            (0, imagekit_1.uploadBufferToImageKit)(variants.thumbnail.buffer, '/lapshark/products/variants', `${nameHint} thumbnail`),
        ]);
        res.json({
            success: true,
            // Flat fields kept for the existing admin form, which only reads these.
            url: masterUpload.url,
            width: masterUpload.width,
            height: masterUpload.height,
            viewType,
            appliedSettings: { scale: merged.scale, position: merged.position },
            images: {
                master: { url: masterUpload.url, width: variants.master.width, height: variants.master.height },
                product: { url: productUpload.url, width: variants.product.width, height: variants.product.height },
                thumbnail: { url: thumbnailUpload.url, width: variants.thumbnail.width, height: variants.thumbnail.height },
            },
            metadata: {
                viewType,
                appliedSettings: merged,
            },
        });
    }
    catch (error) {
        console.error('Error processing image:', error);
        // Provider/internal detail stays server-side in prod.
        const message = process.env.NODE_ENV === 'production' ? undefined : error.message;
        res.status(500).json({ message: 'Image processing failed', error: message });
    }
});
exports.processImage = processImage;
