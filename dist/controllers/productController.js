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
const imageProcessing_1 = require("../services/imageProcessing");
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
        // MAIN IMAGE UPLOAD
        if ((_a = files === null || files === void 0 ? void 0 : files.image) === null || _a === void 0 ? void 0 : _a[0]) {
            const uploadResult = yield (0, imagekit_1.uploadToImageKit)(files.image[0], "/lapshark/products");
            mainImage = uploadResult.url;
        }
        // GALLERY IMAGE UPLOAD
        if ((_b = files === null || files === void 0 ? void 0 : files.images) === null || _b === void 0 ? void 0 : _b.length) {
            const uploadResults = yield Promise.all(files.images.map((img) => (0, imagekit_1.uploadToImageKit)(img, "/lapshark/products/gallery")));
            galleryImages = uploadResults.map(res => res.url);
        }
        // URL-based images — used by the CRM's Product Sync Service (already
        // hosted elsewhere) and by the admin form's auto background-removal step
        // (already hosted on ImageKit by the time Save runs). Main image: file
        // wins if both are present. Gallery: appended alongside any uploaded
        // files rather than replacing them, since a save can legitimately mix
        // processed URLs with raw-file fallbacks for images that failed to process.
        if (!mainImage && req.body.imageUrl) {
            const uploaded = yield (0, imagekit_1.uploadUrlToImageKit)(req.body.imageUrl, "/lapshark/products");
            mainImage = uploaded.url;
        }
        if (req.body.imageUrls) {
            const urls = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
            const uploadResults = yield Promise.all(urls.map((u) => (0, imagekit_1.uploadUrlToImageKit)(u, "/lapshark/products/gallery")));
            galleryImages = [...galleryImages, ...uploadResults.map((res) => res.url)];
        }
        // Parse JSON data from form-data
        const productData = Object.assign(Object.assign({}, req.body), { price: Number(req.body.price), discountPercent: Number(req.body.discountPercent || 0), stock: Number(req.body.stock), rating: Number(req.body.rating || 0), reviews: Number(req.body.reviews || 0), finalPrice: Number(req.body.finalPrice), image: mainImage, images: galleryImages, specs: req.body.specs ? JSON.parse(req.body.specs) : {}, configOptions: req.body.configOptions ? JSON.parse(req.body.configOptions) : undefined, isNewItem: req.body.isNewItem === 'true', isTrending: req.body.isTrending === 'true', isBestDeal: req.body.isBestDeal === 'true' });
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
        //
        // 1️⃣ MAIN IMAGE (Upload to ImageKit)
        //
        if ((_a = files === null || files === void 0 ? void 0 : files.image) === null || _a === void 0 ? void 0 : _a[0]) {
            const uploadResult = yield (0, imagekit_1.uploadToImageKit)(files.image[0], "/lapshark/products");
            product.image = uploadResult.url;
        }
        else if (req.body.imageUrl) {
            // URL-based main image — same CRM sync use case as createProduct above.
            const uploaded = yield (0, imagekit_1.uploadUrlToImageKit)(req.body.imageUrl, "/lapshark/products");
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
            const uploadedGallery = yield Promise.all(files.images.map((file) => (0, imagekit_1.uploadToImageKit)(file, "/lapshark/products/gallery")));
            galleryImages = [...galleryImages, ...uploadedGallery.map(r => r.url)];
        }
        if (req.body.imageUrls) {
            // URL-based gallery images — same CRM sync use case as createProduct.
            const urls = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
            const uploadedGallery = yield Promise.all(urls.map((u) => (0, imagekit_1.uploadUrlToImageKit)(u, "/lapshark/products/gallery")));
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
// Multipart fields arrive as strings — `settings` is sent as a JSON string
// when present (mirrors how `viewType` is just a plain field). Invalid JSON
// is treated as "no overrides" rather than a hard error, since composition
// overrides are optional.
function parseSettingsField(raw) {
    if (!raw)
        return undefined;
    if (typeof raw === 'object')
        return raw;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch (_a) {
            return undefined;
        }
    }
    return undefined;
}
// Runs a picked file (or an already-hosted image, for reprocessing) through
// PhotoRoom background removal + view-preset-driven studio compositing, then
// uploads the result to ImageKit. Called by the admin form the instant an
// image is picked, before the product itself is saved — the returned URL is
// what createProduct/updateProduct receive via imageUrl/imageUrls.
const processImage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
        }
        else {
            return res.status(400).json({ message: 'No image file or imageUrl provided' });
        }
        const viewType = req.body.viewType in imageProcessing_1.VIEW_PRESETS ? req.body.viewType : 'custom';
        const settings = parseSettingsField(req.body.settings);
        const result = yield (0, imageProcessing_1.processProductImage)({ input: inputBuffer, mimeType, viewType, settings });
        const uploaded = yield (0, imagekit_1.uploadBufferToImageKit)(result.buffer, '/lapshark/products');
        res.json({
            url: uploaded.url,
            width: uploaded.width,
            height: uploaded.height,
            viewType: result.viewType,
            appliedSettings: { scale: result.appliedScale, position: result.appliedPosition },
        });
    }
    catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ message: 'Image processing failed', error: error.message });
    }
});
exports.processImage = processImage;
