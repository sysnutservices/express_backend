"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const productController_1 = require("../controllers/productController");
const orderController_1 = require("../controllers/orderController");
const authController_1 = require("../controllers/authController");
const adminController_1 = require("../controllers/adminController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const couponController_1 = require("../controllers/couponController");
const uploadController_1 = require("../controllers/uploadController");
const router = express_1.default.Router();
const uploadFields = productController_1.upload.fields([
    { name: 'image', maxCount: 1 }, // Main image
    { name: 'images', maxCount: 10 } // Gallery images
]);
// Products
router.route('/products').get(productController_1.getProducts).post(uploadFields, productController_1.createProduct);
router.route('/products/:id').get(productController_1.getProductById).put(uploadFields, productController_1.updateProduct).delete(authMiddleware_1.protect, authMiddleware_1.admin, productController_1.deleteProduct);
router.get("/gallery/images", authMiddleware_1.protect, uploadController_1.getImages);
router.post("/gallery/upload", authMiddleware_1.protect, uploadController_1.galleryUpload.single("image"), uploadController_1.uploadSingleImage);
router.post("/gallery/upload/multiple", authMiddleware_1.protect, uploadController_1.galleryUpload.array("images", 10), uploadController_1.uploadMultipleImages);
router.delete("/gallery/delete-image", authMiddleware_1.protect, uploadController_1.deleteImage);
// Orders
router.post("/orders/create", authMiddleware_1.protect, orderController_1.createOrder);
router.post("/orders/verify", authMiddleware_1.protect, orderController_1.verifyPayment);
router.get("/orders/mine", authMiddleware_1.protect, orderController_1.getUserOrders);
router.get("/orders/:id", authMiddleware_1.protect, orderController_1.getOrderById);
router.get("/orders/", orderController_1.adminGetAllOrders);
router.put("/orders/:id/status", orderController_1.updateOrderStatus);
router.put("/orders/:id/cancel", orderController_1.cancelOrder);
// Site Config
router.get('/site-config', adminController_1.getSiteConfig);
// Users
router.post('/users/login', authController_1.customerLogin);
router.post('/users/otp', authController_1.sendOTP);
router.post('/users/admin/login', authController_1.adminLogin);
router.get('/users', authMiddleware_1.protect, authMiddleware_1.admin, authController_1.getUsers);
router.route('/users/:id/block').put(authMiddleware_1.protect, authMiddleware_1.admin, authController_1.blockUser);
router.put('/users/profile', authMiddleware_1.protect, authController_1.updateProfile);
router.post('/users/address', authMiddleware_1.protect, authController_1.addAddress);
router.get('/users/address', authMiddleware_1.protect, authController_1.getAddresses);
router.put('/users/address/:addressId', authMiddleware_1.protect, authController_1.updateAddress);
router.delete('/users/address/:addressId', authMiddleware_1.protect, authController_1.deleteAddress);
router.post('/users/address/:addressId/set-default', authMiddleware_1.protect, authController_1.setDefaultAddress);
router.route('/coupons').get(couponController_1.getCoupons).post(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.createCoupon);
router.route('/coupons/:id').put(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.updateCoupon).delete(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.deleteCoupon);
router.route('/coupons/validate').post(couponController_1.validateCoupon);
// Admin / Site Config
router.get('/admin/stats', authMiddleware_1.protect, authMiddleware_1.admin, adminController_1.getDashboardStats);
router.route('/admin/site-config').get(adminController_1.getSiteConfig).put(authMiddleware_1.protect, authMiddleware_1.admin, adminController_1.updateSiteConfig);
exports.default = router;
