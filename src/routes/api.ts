import express from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct, upload, getProductBySlug, processImage } from '../controllers/productController';
import { adminGetAllOrders, cancelOrder, createOrder, getOrderById, getUserOrders, updateOrderStatus, verifyPayment, razorpayWebhook, sendLoanEnquiry, checkPincodeServiceability, shipmentWebhook } from '../controllers/orderController';
import { getUsers, blockUser, customerLogin, adminLogin, sendOTP, addAddress, updateAddress, deleteAddress, setDefaultAddress, getAddresses, updateProfile } from '../controllers/authController';
import { getDashboardStats, getSiteConfig, updateSiteConfig } from '../controllers/adminController';
import { protect, admin, internalOnly } from '../middleware/authMiddleware';
import { createCoupon, deleteCoupon, getCoupons, updateCoupon, validateCoupon } from '../controllers/couponController';
import { ingestEvent, getOverviewStats, getProductAnalytics, getVisitors, getVisitorJourney } from '../controllers/analyticsController';
import { createBlog, getAllBlogs, getAllBlogsAdmin, getBlogBySlug, updateBlog, deleteBlog } from '../controllers/blogController';
import { getGalleryImages, galleryUpload, uploadGalleryImage, uploadMultipleGalleryImages, deleteGalleryImage } from '../controllers/galleryController';
import { getWishlist, addToWishlist, removeFromWishlist } from '../controllers/wishlistController';
import { getCart, addToCart, updateCartItem, removeCartItem, clearCart, getCartByWaId, getAllCart, notifiedCart, getAbandonedCartSettings, updateAbandonedCartSettings } from '../controllers/cartController';
// import { deleteImage, galleryUpload, getImages, uploadMultipleImages, uploadSingleImage } from '../controllers/uploadController';

const router = express.Router();

// Public catalogue reads carry no per-user data, so they can be cached briefly.
// Responses previously had no Cache-Control at all, forcing every SSR render and
// every browser to re-download in full. Only applied to GET on public routes —
// never to cart/orders/user endpoints.
const publicCache = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
) => {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    next();
};

const uploadFields = upload.fields([
    { name: 'image', maxCount: 1 },      // Main image
    { name: 'images', maxCount: 10 }     // Gallery images
]);

// Products
// Writes are admin-only: create and update were previously open, so anyone
// could add or edit catalogue entries.
router.route('/products').get(publicCache, getProducts).post(protect, admin, uploadFields, createProduct);
router.route('/products/:id').get(publicCache, getProductById).put(protect, admin, uploadFields, updateProduct).delete(protect, admin, deleteProduct);
router.route('/products/slug/:slug').get(publicCache, getProductBySlug);
// Runs PhotoRoom background removal + studio compositing on a single picked
// file (or an already-hosted URL, for reprocessing) and returns the hosted
// result — called by the admin form before Save, not part of the product CRUD.
router.post('/products/process-image', protect, admin, upload.single('image'), processImage);


// Site Editor's image library — admin CMS only, no customer-facing use.
// protect alone (no admin) let any logged-in customer list/upload/delete it.
router.get("/gallery/images", protect, admin, getGalleryImages);
router.post("/gallery/upload", protect, admin, galleryUpload.single("image"), uploadGalleryImage);
router.post("/gallery/upload/multiple", protect, admin, galleryUpload.array("images", 10), uploadMultipleGalleryImages);
router.delete("/gallery/delete-image/:fileId", protect, admin, deleteGalleryImage); // Updated route to accept fileId param
router.delete("/gallery/delete-image", protect, admin, deleteGalleryImage); // Keep body-based delete for flexibility if needed

// Orders
router.post("/orders/create", protect, createOrder);
router.post("/orders/verify", protect, verifyPayment);
// Razorpay's own server calls this, not a logged-in Lapshark user — no
// protect; authenticated instead by verifying Razorpay's webhook signature
// inside the handler (see razorpayWebhook's comment).
router.post("/orders/webhook", razorpayWebhook);
router.get("/orders/mine", protect, getUserOrders);
// getOrderById/cancelOrder check ownership (or admin) inside the controller
// — protect alone would still let any logged-in customer view/cancel any
// other customer's order by id.
router.get("/orders/:id", protect, getOrderById);

router.get("/orders/", protect, admin, adminGetAllOrders);
router.put("/orders/:id/status", protect, admin, updateOrderStatus);
router.put("/orders/:id/cancel", protect, cancelOrder);

// Pincode check at the checkout address step — public, no order/user context needed.
router.get("/shipping/serviceability/:pincode", checkPincodeServiceability);
// Ekart's own server calls this — see shipmentWebhook's comment for why no protect.
router.post("/orders/shipment-webhook", shipmentWebhook);

// Site Config
router.get('/site-config', publicCache, getSiteConfig);

// Users
router.post('/users/login', customerLogin);
router.post('/users/otp', sendOTP);
router.post('/users/admin/login', adminLogin);
router.get('/users', protect, admin, getUsers);
router.route('/users/:id/block').put(protect, admin, blockUser);
router.put('/users/profile', protect, updateProfile);

router.post('/users/address', protect, addAddress);
router.get('/users/address', protect, getAddresses);
router.put('/users/address/:addressId', protect, updateAddress);
router.delete('/users/address/:addressId', protect, deleteAddress);
router.post('/users/address/:addressId/set-default', protect, setDefaultAddress);

// The full coupon list is admin-panel-only — checkout validates a single
// code via /coupons/validate instead, so this never needed to be public.
router.route('/coupons').get(protect, admin, getCoupons).post(protect, admin, createCoupon);
router.route('/coupons/:id').put(protect, admin, updateCoupon).delete(protect, admin, deleteCoupon);
router.route('/coupons/validate').post(validateCoupon);

// Analytics
// Deliberately public (no protect) — protect 401s outright on a missing
// token, which would break tracking for every anonymous (not-logged-in)
// visitor. ingestEvent does its own best-effort, swallowed-on-failure JWT
// decode internally instead — see analyticsController.ts.
router.post('/analytics/events', ingestEvent);
router.get('/admin/analytics/overview', protect, admin, getOverviewStats);
router.get('/admin/analytics/products', protect, admin, getProductAnalytics);
router.get('/admin/analytics/visitors', protect, admin, getVisitors);
router.get('/admin/analytics/visitors/:visitorId', protect, admin, getVisitorJourney);
// Admin / Site Config
router.get('/admin/stats', protect, admin, getDashboardStats);
router.route('/admin/site-config').get(getSiteConfig).put(protect, admin, updateSiteConfig);

// Writes are admin-only: these were previously open, so anyone could publish or
// delete posts on the domain.
router.post("/blogs", protect, admin, createBlog);
router.get("/blogs", publicCache, getAllBlogs);
// Admin feed including drafts. Deliberately uncached and above /blogs/slug so
// the literal "all" path is never captured as a slug.
router.get("/blogs/all", protect, admin, getAllBlogsAdmin);
// Single-post lookup so the blog page doesn't fetch the entire collection.
router.get("/blogs/slug/:slug", publicCache, getBlogBySlug);
router.put("/blogs/:id", protect, admin, updateBlog);
router.delete("/blogs/:id", protect, admin, deleteBlog);


router.get("/wishlist", protect, getWishlist);
router.post("/wishlist/add", protect, addToWishlist);
router.delete("/wishlist/:productId", protect, removeFromWishlist);


router.get("/cart", protect, getCart);
router.post("/cart/add", protect, addToCart);
router.put("/cart/update", protect, updateCartItem);
router.delete("/cart/remove/:productId", protect, removeCartItem);
// Called by wamigo_backend's abandoned-cart cron/flow executor, not by any
// logged-in Lapshark user — no auth at all otherwise let anyone read a
// customer's cart by phone number or mark/silence carts.
router.get("/cart/all", internalOnly, getAllCart);
router.put("/cart/notified/:cartId", internalOnly, notifiedCart)
router.get("/cart/waId/:waId", internalOnly, getCartByWaId);
// No known caller for these — admin-panel-shaped config with no UI built
// yet, so gate it the way that UI would need to anyway.
router.put("/cart/settings", protect, admin, updateAbandonedCartSettings);
router.get("/cart/settings", protect, admin, getAbandonedCartSettings);
router.post("/loan/enquiry", protect, sendLoanEnquiry);

router.delete("/cart/clear", protect, clearCart);

// PUBLIC
router.get("/public", getAllBlogs);
export default router;