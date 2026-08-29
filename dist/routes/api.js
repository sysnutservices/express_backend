"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const productController_1 = require("../controllers/productController");
const productImageController_1 = require("../controllers/productImageController");
const aiSettingsController_1 = require("../controllers/aiSettingsController");
const orderController_1 = require("../controllers/orderController");
const authController_1 = require("../controllers/authController");
const adminController_1 = require("../controllers/adminController");
const authMiddleware_1 = require("../middleware/authMiddleware");
const couponController_1 = require("../controllers/couponController");
const analyticsController_1 = require("../controllers/analyticsController");
const blogController_1 = require("../controllers/blogController");
const galleryController_1 = require("../controllers/galleryController");
const wishlistController_1 = require("../controllers/wishlistController");
const cartController_1 = require("../controllers/cartController");
const reviewController_1 = require("../controllers/reviewController");
const contactController_1 = require("../controllers/contactController");
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
// OpenAI GPT Image 2 + Sharp product-image workflow (original -> AI version
// -> review -> approve -> publish). Kept fully separate from the routes
// above: those still serve the create-new-product flow's PhotoRoom pipeline
// unchanged (see productImageOrchestrator.ts for why).
router.post('/products/:productId/images/upload-original', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.uploadOriginalMiddleware, productImageController_1.uploadOriginal);
router.get('/products/:productId/images', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.listProductImages);
router.post('/products/images/:rootImageId/process', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.processRootImage);
router.patch('/products/images/versions/:versionId/settings', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.updateVersionSettings);
router.post('/products/images/versions/:versionId/approve', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.approveVersion);
router.post('/products/images/versions/:versionId/reject', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.rejectVersion);
router.post('/products/images/versions/:versionId/return-to-review', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.returnVersionToReview);
router.patch('/products/:productId/images/reorder', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.reorderProductImages);
router.post('/products/:productId/images/publish', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.publishProduct);
router.get('/admin/ai-usage/summary', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.getUsageSummary);
router.get('/admin/ai-usage/by-product', authMiddleware_1.protect, authMiddleware_1.admin, productImageController_1.getUsageByProductHandler);
// OPENAI_API_KEY management — written to the backend's .env file, never the
// database, never echoed back in a response (see aiSettingsController.ts).
router.get('/admin/ai-settings', authMiddleware_1.protect, authMiddleware_1.admin, aiSettingsController_1.getAiSettingsStatus);
router.put('/admin/ai-settings', authMiddleware_1.protect, authMiddleware_1.admin, aiSettingsController_1.updateAiSettings);
router.post('/admin/ai-settings/test', authMiddleware_1.protect, authMiddleware_1.admin, aiSettingsController_1.testAiConnection);
// Reviews — one per user per product, createReview upserts (see controller).
router.get('/reviews/featured', publicCache, reviewController_1.getFeaturedReviews);
router.get('/products/:productId/reviews', publicCache, reviewController_1.getProductReviews);
router.post('/products/:productId/reviews', authMiddleware_1.protect, reviewController_1.createReview);
// No moderation UI yet — direct admin-authenticated call is the removal path.
router.delete('/admin/reviews/:reviewId', authMiddleware_1.protect, authMiddleware_1.admin, reviewController_1.deleteReview);
// Site Editor's image library — admin CMS only, no customer-facing use.
// protect alone (no admin) let any logged-in customer list/upload/delete it.
router.get("/gallery/images", authMiddleware_1.protect, authMiddleware_1.admin, galleryController_1.getGalleryImages);
router.post("/gallery/upload", authMiddleware_1.protect, authMiddleware_1.admin, galleryController_1.galleryUpload.single("image"), galleryController_1.uploadGalleryImage);
router.post("/gallery/upload/multiple", authMiddleware_1.protect, authMiddleware_1.admin, galleryController_1.galleryUpload.array("images", 10), galleryController_1.uploadMultipleGalleryImages);
router.delete("/gallery/delete-image/:fileId", authMiddleware_1.protect, authMiddleware_1.admin, galleryController_1.deleteGalleryImage); // Updated route to accept fileId param
router.delete("/gallery/delete-image", authMiddleware_1.protect, authMiddleware_1.admin, galleryController_1.deleteGalleryImage); // Keep body-based delete for flexibility if needed
// Orders
router.post("/orders/create", authMiddleware_1.protect, orderController_1.createOrder);
router.post("/orders/verify", authMiddleware_1.protect, orderController_1.verifyPayment);
// Razorpay's own server calls this, not a logged-in Lapshark user — no
// protect; authenticated instead by verifying Razorpay's webhook signature
// inside the handler (see razorpayWebhook's comment).
router.post("/orders/webhook", orderController_1.razorpayWebhook);
router.get("/orders/mine", authMiddleware_1.protect, orderController_1.getUserOrders);
// getOrderById/cancelOrder check ownership (or admin) inside the controller
// — protect alone would still let any logged-in customer view/cancel any
// other customer's order by id.
router.get("/orders/:id", authMiddleware_1.protect, orderController_1.getOrderById);
router.get("/orders/", authMiddleware_1.protect, authMiddleware_1.admin, orderController_1.adminGetAllOrders);
router.put("/orders/:id/status", authMiddleware_1.protect, authMiddleware_1.admin, orderController_1.updateOrderStatus);
router.put("/orders/:id/cancel", authMiddleware_1.protect, orderController_1.cancelOrder);
// Pincode check at the checkout address step — public, no order/user context needed.
router.get("/shipping/serviceability/:pincode", orderController_1.checkPincodeServiceability);
// Ekart's own server calls this — see shipmentWebhook's comment for why no protect.
router.post("/orders/shipment-webhook", orderController_1.shipmentWebhook);
// Site Config
router.get('/site-config', publicCache, adminController_1.getSiteConfig);
// Users
router.post('/users/login', authController_1.customerLogin);
router.post('/users/otp', authController_1.sendOTP);
router.post('/users/admin/login', authController_1.adminLogin);
router.get('/users', authMiddleware_1.protect, authMiddleware_1.admin, authController_1.getUsers);
router.route('/users/:id/block').put(authMiddleware_1.protect, authMiddleware_1.admin, authController_1.blockUser);
router.post('/users/:id/force-logout', authMiddleware_1.protect, authMiddleware_1.admin, authController_1.forceLogoutUser);
router.put('/users/profile', authMiddleware_1.protect, authController_1.updateProfile);
router.post('/users/address', authMiddleware_1.protect, authController_1.addAddress);
router.get('/users/address', authMiddleware_1.protect, authController_1.getAddresses);
router.put('/users/address/:addressId', authMiddleware_1.protect, authController_1.updateAddress);
router.delete('/users/address/:addressId', authMiddleware_1.protect, authController_1.deleteAddress);
router.post('/users/address/:addressId/set-default', authMiddleware_1.protect, authController_1.setDefaultAddress);
// The full coupon list is admin-panel-only — checkout validates a single
// code via /coupons/validate instead, so this never needed to be public.
router.route('/coupons').get(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.getCoupons).post(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.createCoupon);
router.route('/coupons/:id').put(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.updateCoupon).delete(authMiddleware_1.protect, authMiddleware_1.admin, couponController_1.deleteCoupon);
router.route('/coupons/validate').post(couponController_1.validateCoupon);
// Analytics
// Deliberately public (no protect) — protect 401s outright on a missing
// token, which would break tracking for every anonymous (not-logged-in)
// visitor. ingestEvent does its own best-effort, swallowed-on-failure JWT
// decode internally instead — see analyticsController.ts.
router.post('/analytics/events', analyticsController_1.ingestEvent);
router.get('/admin/analytics/overview', authMiddleware_1.protect, authMiddleware_1.admin, analyticsController_1.getOverviewStats);
router.get('/admin/analytics/products', authMiddleware_1.protect, authMiddleware_1.admin, analyticsController_1.getProductAnalytics);
router.get('/admin/analytics/visitors', authMiddleware_1.protect, authMiddleware_1.admin, analyticsController_1.getVisitors);
router.get('/admin/analytics/visitors/:visitorId', authMiddleware_1.protect, authMiddleware_1.admin, analyticsController_1.getVisitorJourney);
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
// Called by wamigo_backend's abandoned-cart cron/flow executor, not by any
// logged-in Lapshark user — no auth at all otherwise let anyone read a
// customer's cart by phone number or mark/silence carts.
router.get("/cart/all", authMiddleware_1.internalOnly, cartController_1.getAllCart);
router.put("/cart/notified/:cartId", authMiddleware_1.internalOnly, cartController_1.notifiedCart);
router.get("/cart/waId/:waId", authMiddleware_1.internalOnly, cartController_1.getCartByWaId);
// No known caller for these — admin-panel-shaped config with no UI built
// yet, so gate it the way that UI would need to anyway.
router.put("/cart/settings", authMiddleware_1.protect, authMiddleware_1.admin, cartController_1.updateAbandonedCartSettings);
router.get("/cart/settings", authMiddleware_1.protect, authMiddleware_1.admin, cartController_1.getAbandonedCartSettings);
router.post("/loan/enquiry", authMiddleware_1.protect, orderController_1.sendLoanEnquiry);
// Contact Us form — genuinely public (unlike loan/enquiry above, the
// contact page has no login gate, so this can't require one either).
router.post("/contact", contactController_1.createContactMessage);
router.get("/admin/contact-messages", authMiddleware_1.protect, authMiddleware_1.admin, contactController_1.getContactMessages);
router.put("/admin/contact-messages/:id/status", authMiddleware_1.protect, authMiddleware_1.admin, contactController_1.updateContactMessageStatus);
router.delete("/cart/clear", authMiddleware_1.protect, cartController_1.clearCart);
// PUBLIC
router.get("/public", blogController_1.getAllBlogs);
exports.default = router;
