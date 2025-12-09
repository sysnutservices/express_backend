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
exports.deleteProduct = exports.updateProduct = exports.createProduct = exports.getProductById = exports.getProducts = exports.upload = void 0;
const Product_1 = __importDefault(require("../models/Product"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const imagekit_1 = require("../services/imagekit");
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
const uploadToImageKit = (file, folder) => __awaiter(void 0, void 0, void 0, function* () {
    const ext = path_1.default.extname(file.originalname);
    const filename = "product-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    const uploaded = yield imagekit_1.imagekit.upload({
        file: file.buffer,
        fileName: filename,
        folder,
    });
    return uploaded.url;
});
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
const createProduct = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const files = req.files;
        // Get main image
        let mainImage = "";
        let galleryImages = [];
        // MAIN IMAGE UPLOAD
        if ((_a = files === null || files === void 0 ? void 0 : files.image) === null || _a === void 0 ? void 0 : _a[0]) {
            mainImage = yield uploadToImageKit(files.image[0], "/lapshark/products");
        }
        // GALLERY IMAGE UPLOAD
        if ((_b = files === null || files === void 0 ? void 0 : files.images) === null || _b === void 0 ? void 0 : _b.length) {
            galleryImages = yield Promise.all(files.images.map((img) => uploadToImageKit(img, "/lapshark/products/gallery")));
        }
        // Parse JSON data from form-data
        const productData = Object.assign(Object.assign({}, req.body), { price: Number(req.body.price), discountPercent: Number(req.body.discountPercent || 0), stock: Number(req.body.stock), rating: Number(req.body.rating || 0), reviews: Number(req.body.reviews || 0), finalPrice: Number(req.body.finalPrice), image: mainImage, images: galleryImages, specs: req.body.specs ? JSON.parse(req.body.specs) : {}, configOptions: req.body.configOptions ? JSON.parse(req.body.configOptions) : undefined, isNewItem: req.body.isNewItem === 'true', isTrending: req.body.isTrending === 'true', isBestDeal: req.body.isBestDeal === 'true' });
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
            product.image = yield uploadToImageKit(files.image[0], "/lapshark/products");
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
        // Upload NEW gallery images to ImageKit
        if ((_b = files === null || files === void 0 ? void 0 : files.images) === null || _b === void 0 ? void 0 : _b.length) {
            const uploadedGallery = yield Promise.all(files.images.map((file) => uploadToImageKit(file, "/lapshark/products/gallery")));
            galleryImages = [...galleryImages, ...uploadedGallery];
        }
        product.images = galleryImages;
        //
        // 3️⃣ Parse JSON fields and ASSIGN them back to product
        //
        if (req.body.specs) {
            try {
                product.specs = JSON.parse(req.body.specs);
            }
            catch (err) {
                console.error("Invalid specs JSON", err);
            }
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
