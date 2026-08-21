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
exports.sendLoanEnquiry = exports.cancelOrder = exports.updateOrderStatus = exports.adminGetAllOrders = exports.getOrderById = exports.getUserOrders = exports.verifyPayment = exports.createOrder = void 0;
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const razorpay_1 = __importDefault(require("razorpay"));
const Order_1 = __importDefault(require("../models/Order"));
const Product_1 = __importDefault(require("../models/Product"));
const Coupon_1 = __importDefault(require("../models/Coupon"));
const wa_1 = require("../services/wa");
const notifyByKey_1 = require("../services/notifyByKey");
const Enquiry_1 = require("../models/Enquiry");
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY,
    key_secret: process.env.RAZORPAY_SECRET,
});
// =========================================================
// 1️⃣ CREATE ORDER (Internal + Razorpay Order)
// =========================================================
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { customerName, customerEmail, items, mapLink, shippingAddress, paymentMethod, coupon } = req.body;
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || null;
        // ---- Fetch Products ----
        const productIds = items.map((i) => i.productId);
        const products = yield Product_1.default.find({ _id: { $in: productIds } });
        if (!products.length) {
            return res.status(404).json({ message: "Products not found" });
        }
        // ---- Validate Coupon ----
        let couponData = null;
        if (coupon) {
            couponData = yield Coupon_1.default.findOne({ code: coupon });
            if (!couponData)
                return res.status(404).json({ message: "Invalid coupon code" });
        }
        // ---- Calculate Total ----
        let total = 0;
        const updatedItems = items.map((item) => {
            const product = products.find((p) => p._id.toString() === item.productId);
            if (!product)
                throw new Error("Product not found");
            // Config pricing
            const ramOption = product.configOptions.ram.find((r) => r.value === item.config.ram);
            const storageOption = product.configOptions.storage.find((s) => s.value === item.config.storage);
            const warrantyOption = product.configOptions.warranty.find((w) => w.value === item.config.warranty);
            const configCost = ((ramOption === null || ramOption === void 0 ? void 0 : ramOption.price) || 0) +
                ((storageOption === null || storageOption === void 0 ? void 0 : storageOption.price) || 0) +
                ((warrantyOption === null || warrantyOption === void 0 ? void 0 : warrantyOption.price) || 0);
            const finalPrice = product.finalPrice + configCost;
            const subtotal = finalPrice * item.quantity;
            total += subtotal;
            return {
                productId: item.productId,
                title: product.title,
                quantity: item.quantity,
                finalPrice,
                image: product.image,
                storage: storageOption,
                warranty: warrantyOption,
                selectedConfig: item.config
            };
        });
        // ---- Apply Coupon Once (Flat Discount) ----
        if (couponData) {
            total = Math.max(0, total - couponData.value);
        }
        // ---- Create Razorpay Order ----
        const razorpayOrder = yield razorpay.orders.create({
            amount: total * 100, // convert to paisa
            currency: "INR",
            receipt: "order_" + Date.now()
        });
        // ---- Save Order in DB ----
        const newOrder = yield Order_1.default.create({
            orderId: razorpayOrder.id,
            customerName,
            customerEmail,
            userId,
            date: new Date().toISOString(), // FIXED
            total,
            mapLink: mapLink,
            status: "Pending",
            paymentStatus: "Pending",
            paymentMethod,
            couponValue: (couponData === null || couponData === void 0 ? void 0 : couponData.value) || 0,
            shippingAddress: {
                street: shippingAddress.street,
                city: shippingAddress.city,
                state: shippingAddress.state,
                zip: shippingAddress.zip,
                phone: shippingAddress.phone,
                type: shippingAddress.type
            },
            items: updatedItems,
            coupon: (couponData === null || couponData === void 0 ? void 0 : couponData.code) || null,
            razorpayOrderId: razorpayOrder.id
        });
        return res.json({
            success: true,
            order: newOrder,
            razorpayOrderId: razorpayOrder.id,
            amount: total * 100,
            key: process.env.RAZORPAY_KEY
        });
    }
    catch (err) {
        console.error("ORDER ERROR:", err);
        return res
            .status(500)
            .json({ success: false, error: err.message || "Server Error" });
    }
});
exports.createOrder = createOrder;
// =========================================================
// 2️⃣ VERIFY PAYMENT SIGNATURE (MOST IMPORTANT)
// =========================================================
// export const verifyPayment = async (req: Request, res: Response) => {
//   try {
//     const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
//       req.body;
//     // SIGNATURE CHECK (Security)
//     const body = razorpay_order_id + "|" + razorpay_payment_id;
//     const expectedSignature = crypto
//       .createHmac("sha256", process.env.RAZORPAY_SECRET!)
//       .update(body)
//       .digest("hex");
//     if (expectedSignature !== razorpay_signature) {
//       return res.status(400).json({ success: false, message: "Invalid Signature" });
//     }
//     const order = await Order.findOneAndUpdate(
//       { orderId: razorpay_order_id },
//       {
//         paymentStatus: "Paid",
//         status: "Processing",
//         razorpayPaymentId: razorpay_payment_id,
//         razorpaySignature: razorpay_signature,
//         paidAt: new Date(),
//       },
//       { new: true }
//     );
//     res.json({ success: true, order });
//   } catch (err: any) {
//     console.error(err);
//     res.status(500).json({ success: false, error: err.message });
//   }
// };
const verifyPayment = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
        // 1️⃣ Verify Razorpay Signature
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto_1.default
            .createHmac("sha256", process.env.RAZORPAY_SECRET)
            .update(body)
            .digest("hex");
        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Invalid Signature",
            });
        }
        // 2️⃣ Fetch Order + Populate User
        const order = yield Order_1.default.findOne({ orderId: razorpay_order_id }).populate("userId");
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        // Type fix here:
        const user = order.userId;
        const customerName = user.name;
        const customerPhone = user.mobile;
        // 3️⃣ Update the order payment status
        order.paymentStatus = "Paid";
        order.status = "Processing";
        order.razorpayPaymentId = razorpay_payment_id;
        order.razorpaySignature = razorpay_signature;
        order.paidAt = new Date();
        yield order.save();
        // 5️⃣ Send WhatsApp Order Confirmation
        yield (0, wa_1.sendOrderConfirmation)(customerPhone, customerName, razorpay_order_id);
        yield (0, wa_1.sendAdminOrderConfirmationPayload)(customerName, customerPhone, razorpay_order_id, order.total, order.date);
        // 🔔 EVENT EMITTED HERE
        yield (0, notifyByKey_1.notifyByKey)("payment.success", {
            entityId: order.orderId,
            payload: {
                amount: order.total,
                paymentId: razorpay_payment_id
            },
            req
        });
        // 6️⃣ Return the updated order 
        res.json({ success: true, order });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.verifyPayment = verifyPayment;
// =========================================================
// 3️⃣ GET USER ORDERS
// =========================================================
const getUserOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const userId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.id;
        const orders = yield Order_1.default.find({ userId }).sort({ createdAt: -1 });
        res.json({ success: true, orders });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.getUserOrders = getUserOrders;
// =========================================================
// 4️⃣ GET ORDER BY ID
// =========================================================
const getOrderById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const order = yield Order_1.default.findOne({ orderId: req.params.id });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        res.json({ success: true, order });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.getOrderById = getOrderById;
// =========================================================
// 5️⃣ ADMIN: GET ALL ORDERS
// =========================================================
const adminGetAllOrders = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const orders = yield Order_1.default.find().sort({ createdAt: -1 });
        res.json({ success: true, orders });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.adminGetAllOrders = adminGetAllOrders;
// =========================================================
// 6️⃣ UPDATE ORDER STATUS 
// (Processing → Shipped → Delivered → Cancelled)
// =========================================================
const updateOrderStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        const { id } = req.params; // this is orderId, not _id
        const order = yield Order_1.default.findOneAndUpdate({ orderId: id }, // ⭐ FIND USING orderId
        { status }, { new: true });
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        res.json({ success: true, order });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.updateOrderStatus = updateOrderStatus;
// =========================================================
// 7️⃣ CANCEL ORDER
// =========================================================
const cancelOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const order = yield Order_1.default.findById(req.params.id);
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        order.status = "Cancelled";
        order.paymentStatus = "Failed";
        yield order.save();
        res.json({ success: true, order });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.cancelOrder = cancelOrder;
const sendLoanEnquiry = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { phone } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, message: "Phone is required" });
        }
        const existing = yield Enquiry_1.LoanEnquiry.findOne({ phone });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "Loan enquiry already submitted",
            });
        }
        yield Enquiry_1.LoanEnquiry.create({ phone });
        yield (0, wa_1.sendAdminLoanEnquiryPayload)(phone);
        res.json({
            success: true,
            message: "Loan enquiry submitted successfully",
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.sendLoanEnquiry = sendLoanEnquiry;
