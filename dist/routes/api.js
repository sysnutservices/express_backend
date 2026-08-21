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
const blogController_1 = require("../controllers/blogController");
const galleryController_1 = require("../controllers/galleryController");
const wishlistController_1 = require("../controllers/wishlistController");
const cartController_1 = require("../controllers/cartController");
// import { deleteImage, galleryUpload, getImages, uploadMultipleImages, uploadSingleImage } from '../controllers/uploadController';
const router = express_1.default.Router();
// Public catalogue reads carry no per-user data, so they can be cached briefly.
// Responses previously had no Cache-Control at all, forcing every SSR render and
// every browser to re-download in full. Only applied to GET on public routes —
// never to cart/orders/user endpoints.
const publicCache = (_req, res, next) => {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    next();
};
const uploadFields = productController_1.upload.fields([
    { name: 'image', maxCount: 1 }, // Main image
    { name: 'images', maxCount: 10 } // Gallery images
]);
// Products
// Writes are admin-only: create and update were previously open, so anyone
// could add or edit catalogue entries.
router.route('/products').get(publicCache, productController_1.getProducts).post(authMiddleware_1.protect, authMiddleware_1.admin, uploadFields, productController_1.createProduct);
router.route('/products/:id').get(publicCache, productController_1.getProductById).put(authMiddleware_1.protect, authMiddleware_1.admin, uploadFields, productController_1.updateProduct).delete(authMiddleware_1.protect, authMiddleware_1.admin, productController_1.deleteProduct);
router.route('/products/slug/:slug').get(publicCache, productController_1.getProductBySlug);
// Runs PhotoRoom background removal + studio compositing on a single picked
// file (or an already-hosted URL, for reprocessing) and returns the hosted
// result — called by the admin form before Save, not part of the product CRUD.
router.post('/products/process-image', authMiddleware_1.protect, authMiddleware_1.admin, productController_1.upload.single('image'), productController_1.processImage);
router.get("/gallery/images", authMiddleware_1.protect, galleryController_1.getGalleryImages);
router.post("/gallery/upload", authMiddleware_1.protect, galleryController_1.galleryUpload.single("image"), galleryController_1.uploadGalleryImage);
router.post("/gallery/upload/multiple", authMiddleware_1.protect, galleryController_1.galleryUpload.array("images", 10), galleryController_1.uploadMultipleGalleryImages);
router.delete("/gallery/delete-image/:fileId", authMiddleware_1.protect, galleryController_1.deleteGalleryImage); // Updated route to accept fileId param
router.delete("/gallery/delete-image", authMiddleware_1.protect, galleryController_1.deleteGalleryImage); // Keep body-based delete for flexibility if needed
// Orders
router.post("/orders/create", authMiddleware_1.protect, orderController_1.createOrder);
router.post("/orders/verify", authMiddleware_1.protect, orderController_1.verifyPayment);
router.get("/orders/mine", authMiddleware_1.protect, orderController_1.getUserOrders);
router.get("/orders/:id", orderController_1.getOrderById);
router.get("/orders/", orderController_1.adminGetAllOrders);
router.put("/orders/:id/status", orderController_1.updateOrderStatus);
router.put("/orders/:id/cancel", orderController_1.cancelOrder);
// Site Config
router.get('/site-config', publicCache, adminController_1.getSiteConfig);
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
// Writes are admin-only: these were previously open, so anyone could publish or
// delete posts on the domain.
router.post("/blogs", authMiddleware_1.protect, authMiddleware_1.admin, blogController_1.createBlog);
router.get("/blogs", publicCache, blogController_1.getAllBlogs);
// Admin feed including drafts. Deliberately uncached and above /blogs/slug so
// the literal "all" path is never captured as a slug.
router.get("/blogs/all", authMiddleware_1.protect, authMiddleware_1.admin, blogController_1.getAllBlogsAdmin);
// Single-post lookup so the blog page doesn't fetch the entire collection.
router.get("/blogs/slug/:slug", publicCache, blogController_1.getBlogBySlug);
router.put("/blogs/:id", authMiddleware_1.protect, authMiddleware_1.admin, blogController_1.updateBlog);
router.delete("/blogs/:id", authMiddleware_1.protect, authMiddleware_1.admin, blogController_1.deleteBlog);
router.get("/wishlist", authMiddleware_1.protect, wishlistController_1.getWishlist);
router.post("/wishlist/add", authMiddleware_1.protect, wishlistController_1.addToWishlist);
router.delete("/wishlist/:productId", authMiddleware_1.protect, wishlistController_1.removeFromWishlist);
router.get("/cart", authMiddleware_1.protect, cartController_1.getCart);
router.post("/cart/add", authMiddleware_1.protect, cartController_1.addToCart);
router.put("/cart/update", authMiddleware_1.protect, cartController_1.updateCartItem);
router.delete("/cart/remove/:productId", authMiddleware_1.protect, cartController_1.removeCartItem);
router.get("/cart/all", cartController_1.getAllCart);
router.put("/cart/notified/:cartId", cartController_1.notifiedCart);
router.get("/cart/waId/:waId", cartController_1.getCartByWaId);
router.put("/cart/settings", cartController_1.updateAbandonedCartSettings);
router.get("/cart/settings", cartController_1.getAbandonedCartSettings);
router.post("/loan/enquiry", authMiddleware_1.protect, orderController_1.sendLoanEnquiry);
router.delete("/cart/clear", authMiddleware_1.protect, cartController_1.clearCart);
// PUBLIC
router.get("/public", blogController_1.getAllBlogs);
router.post("/loan/enquiry", authMiddleware_1.protect, orderController_1.sendLoanEnquiry);
exports.default = router;
