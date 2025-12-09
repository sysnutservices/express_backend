import express from 'express';
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct, upload } from '../controllers/productController';
import { adminGetAllOrders, cancelOrder, createOrder, getOrderById, getUserOrders, updateOrderStatus, verifyPayment } from '../controllers/orderController';
import { getUsers, blockUser, customerLogin, adminLogin, sendOTP, addAddress, updateAddress, deleteAddress, setDefaultAddress, getAddresses, updateProfile } from '../controllers/authController';
import { getDashboardStats, getSiteConfig, updateSiteConfig } from '../controllers/adminController';
import { protect, admin } from '../middleware/authMiddleware';
import { createCoupon, deleteCoupon, getCoupons, updateCoupon, validateCoupon } from '../controllers/couponController';
import { deleteImage, galleryUpload, getImages, uploadMultipleImages, uploadSingleImage } from '../controllers/uploadController';

const router = express.Router();

const uploadFields = upload.fields([
    { name: 'image', maxCount: 1 },      // Main image
    { name: 'images', maxCount: 10 }     // Gallery images
]);

// Products
router.route('/products').get(getProducts).post(uploadFields, createProduct);
router.route('/products/:id').get(getProductById).put(uploadFields, updateProduct).delete(protect, admin, deleteProduct);


router.get("/gallery/images", protect, getImages);
router.post("/gallery/upload", protect, galleryUpload.single("image"), uploadSingleImage);
router.post("/gallery/upload/multiple", protect, galleryUpload.array("images", 10), uploadMultipleImages);
router.delete("/gallery/delete-image", protect, deleteImage);

// Orders
router.post("/orders/create", protect, createOrder);
router.post("/orders/verify", protect, verifyPayment);
router.get("/orders/mine", protect, getUserOrders);
router.get("/orders/:id", protect, getOrderById);

router.get("/orders/", adminGetAllOrders);
router.put("/orders/:id/status", updateOrderStatus);
router.put("/orders/:id/cancel", cancelOrder);

// Site Config
router.get('/site-config', getSiteConfig);

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

router.route('/coupons').get(getCoupons).post(protect, admin, createCoupon);
router.route('/coupons/:id').put(protect, admin, updateCoupon).delete(protect, admin, deleteCoupon);
router.route('/coupons/validate').post(validateCoupon);
// Admin / Site Config
router.get('/admin/stats', protect, admin, getDashboardStats);
router.route('/admin/site-config').get(getSiteConfig).put(protect, admin, updateSiteConfig);

export default router;