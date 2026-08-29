"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.sendLoanEnquiry = exports.cancelOrder = exports.updateOrderStatus = exports.adminGetAllOrders = exports.getOrderById = exports.getUserOrders = exports.shipmentWebhook = exports.razorpayWebhook = exports.verifyPayment = exports.createOrder = exports.checkPincodeServiceability = void 0;
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const razorpay_1 = __importDefault(require("razorpay"));
const Order_1 = __importDefault(require("../models/Order"));
const Product_1 = __importDefault(require("../models/Product"));
const wa_1 = require("../services/wa");
const notifyByKey_1 = require("../services/notifyByKey");
const Enquiry_1 = require("../models/Enquiry");
const couponController_1 = require("./couponController");
const ekart = __importStar(require("../services/ekart"));
const BehaviorEvent_1 = __importDefault(require("../models/BehaviorEvent"));
const metaCapi_1 = require("../services/metaCapi");
const razorpay = new razorpay_1.default({
    key_id: process.env.RAZORPAY_KEY,
    key_secret: process.env.RAZORPAY_SECRET,
});
// =========================================================
// PINCODE SERVICEABILITY — checkout UX guardrail, not an authority
// =========================================================
// Called from the checkout address step, before payment, so a customer in an
// area Ekart can't reach finds out before paying instead of after (the
// previous failure mode: shipment creation fails post-payment, admin sorts
// it out manually). Not a trust boundary — createOrder/updateOrderStatus
// don't rely on this having been called, so there's nothing to enforce here
// beyond input shape.
const checkPincodeServiceability = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { pincode } = req.params;
        if (!/^\d{6}$/.test(pincode)) {
            return res.status(400).json({ success: false, message: "Invalid pincode" });
        }
        const result = yield ekart.checkServiceability(pincode);
        res.json(Object.assign({ success: true }, result));
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.checkPincodeServiceability = checkPincodeServiceability;
// =========================================================
// 1️⃣ CREATE ORDER (Internal + Razorpay Order)
// =========================================================
const createOrder = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { customerName, customerEmail, items, mapLink, shippingAddress, paymentMethod, coupon, metaEventId } = req.body;
        const userId = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.id) || null;
        // ---- Fetch Products ----
        const productIds = items.map((i) => i.productId);
        const products = yield Product_1.default.find({ _id: { $in: productIds } });
        if (!products.length) {
            return res.status(404).json({ message: "Products not found" });
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
        // ---- Validate + Apply Coupon ----
        // Same rules (active/expiry/usage-limit/min-order-value/percentage-vs-
        // fixed) as the checkout "Apply Coupon" preview — this is the path that
        // actually creates a chargeable order, so it has to enforce them too,
        // not just trust whatever the client already saw from /coupons/validate.
        let discountAmount = 0;
        let appliedCouponCode = null;
        if (coupon) {
            const couponResult = yield (0, couponController_1.validateAndComputeCoupon)(coupon, total);
            if (!couponResult.valid) {
                return res.status(400).json({ message: couponResult.message || "Invalid coupon code" });
            }
            discountAmount = couponResult.discountAmount;
            appliedCouponCode = couponResult.coupon.code;
            total = couponResult.finalAmount;
        }
        // ---- COD advance ----
        // COD still runs through Razorpay for a small upfront amount — full cash
        // on delivery invites no-shows/fake orders, ₹500 up front weeds those
        // out while leaving the rest genuinely COD. If the order is cheaper than
        // the advance itself (heavy coupon, low-value item) there's nothing
        // meaningful left for COD, so it's just charged in full instead.
        // ponytail: flat ₹500, not configurable — make it an env var if it ever
        // needs to vary by order value/category.
        const COD_ADVANCE_AMOUNT = 500;
        const isCOD = paymentMethod === "COD";
        const amountToCharge = isCOD ? (total > COD_ADVANCE_AMOUNT ? COD_ADVANCE_AMOUNT : total) : total;
        // advanceAmount always equals what's actually being charged right now —
        // in the small-order edge case above that's the full total, so the
        // courier-facing "cash still owed" (total - advanceAmount, see
        // updateOrderStatus) correctly comes out to 0 instead of double-charging.
        const advanceAmount = isCOD ? amountToCharge : 0;
        // ---- Create Razorpay Order ----
        const razorpayOrder = yield razorpay.orders.create({
            amount: amountToCharge * 100, // convert to paisa
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
            advanceAmount,
            metaEventId: typeof metaEventId === "string" ? metaEventId : undefined,
            mapLink: mapLink,
            status: "Pending",
            paymentStatus: "Pending",
            paymentMethod,
            couponValue: discountAmount,
            shippingAddress: {
                street: shippingAddress.street,
                city: shippingAddress.city,
                state: shippingAddress.state,
                zip: shippingAddress.zip,
                phone: shippingAddress.phone,
                type: shippingAddress.type
            },
            items: updatedItems,
            coupon: appliedCouponCode,
            razorpayOrderId: razorpayOrder.id
        });
        return res.json({
            success: true,
            order: newOrder,
            razorpayOrderId: razorpayOrder.id,
            amount: amountToCharge * 100,
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
// Shared by verifyPayment (client, right after Razorpay's checkout.js
// succeeds) and razorpayWebhook (Razorpay's own server calling back,
// independent of whether the customer's browser ever managed to). Both are
// legitimate ways to learn a payment succeeded, and either can arrive
// first — the findOneAndUpdate's paymentStatus:{$ne:"Paid"} filter is what
// makes only one of them actually run the side effects below, atomically,
// instead of a read-then-write race letting both send duplicate WhatsApp
// confirmations and double-count the coupon's usedCount.
// =========================================================
function markOrderPaid(razorpayOrderId, razorpayPaymentId, razorpaySignature, req) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const update = {
            paymentStatus: "Paid",
            status: "Processing",
            razorpayPaymentId,
            paidAt: new Date(),
        };
        if (razorpaySignature)
            update.razorpaySignature = razorpaySignature;
        const order = yield Order_1.default.findOneAndUpdate({ orderId: razorpayOrderId, paymentStatus: { $ne: "Paid" } }, update, { new: true }).populate("userId");
        if (!order) {
            // Either no such order, or it was already marked Paid by whichever of
            // verifyPayment/the webhook got here first — side effects already ran
            // there either way, so this call is done.
            return yield Order_1.default.findOne({ orderId: razorpayOrderId });
        }
        const user = order.userId;
        const customerName = user === null || user === void 0 ? void 0 : user.name;
        const customerPhone = user === null || user === void 0 ? void 0 : user.mobile;
        if (order.coupon) {
            yield (0, couponController_1.markCouponUsed)(order.coupon);
        }
        if (customerPhone) {
            yield (0, wa_1.sendOrderConfirmation)(customerPhone, customerName, razorpayOrderId);
            yield (0, wa_1.sendAdminOrderConfirmationPayload)(customerName, customerPhone, razorpayOrderId, order.total, order.date);
        }
        yield (0, notifyByKey_1.notifyByKey)("payment.success", {
            entityId: order.orderId,
            payload: { amount: order.total, paymentId: razorpayPaymentId },
            req,
        });
        // Server-side `purchase` tracking event — this branch only runs once per
        // order (the findOneAndUpdate guard above), whether verifyPayment or the
        // webhook got here first, so it inherits that idempotency for free rather
        // than needing its own. No visitorId/sessionId here (no client session on
        // this code path) — the admin Journey view attributes it via userId once
        // the visitor is identified. Never let a tracking failure block a real
        // payment confirmation.
        try {
            yield BehaviorEvent_1.default.create({
                eventName: "purchase",
                visitorId: null,
                sessionId: null,
                userId: order.userId || undefined,
                properties: {
                    orderId: order.orderId,
                    total: order.total,
                    paymentMethod: order.paymentMethod,
                    itemCount: ((_a = order.items) === null || _a === void 0 ? void 0 : _a.length) || 0,
                    // Per-product breakdown — lets the admin Product Views page compute
                    // real purchase counts per product, not just views/add-to-cart.
                    // Orders are small (a handful of line items), so this stays well
                    // under the 2KB properties cap ingestEvent enforces on the client
                    // path — this write goes straight to Mongo, bypassing that check
                    // entirely, but the size is inherently bounded by cart size anyway.
                    items: (order.items || []).map((i) => ({ productId: i.productId, quantity: i.quantity })),
                },
                source: "server",
            });
        }
        catch (err) {
            console.error("purchase tracking event failed:", err.message);
        }
        // Meta Conversions API — server truth for the Purchase conversion. Uses
        // the same metaEventId the browser's Pixel Purchase call carries (set at
        // checkout, see CheckoutContent.tsx) so Meta dedupes the two into one
        // conversion instead of double-counting. No-ops entirely if
        // META_PIXEL_ID/META_CAPI_ACCESS_TOKEN aren't configured — never blocks
        // payment confirmation on a failure here.
        try {
            yield (0, metaCapi_1.sendCapiEvent)({
                eventName: "Purchase",
                eventId: order.metaEventId,
                eventSourceUrl: `https://lapshark.com/order-success/${order.orderId}`,
                userData: Object.assign({ email: order.customerEmail || undefined, phone: (_b = order.shippingAddress) === null || _b === void 0 ? void 0 : _b.phone, ip: req.ip, userAgent: req.headers["user-agent"] }, (0, metaCapi_1.parseFbCookies)(req.headers.cookie)),
                customData: {
                    value: order.total,
                    currency: "INR",
                    contents: (order.items || []).map((i) => ({ id: i.productId, quantity: i.quantity })),
                },
            });
        }
        catch (err) {
            console.error("Meta CAPI purchase event failed:", ((_c = err.response) === null || _c === void 0 ? void 0 : _c.data) || err.message);
        }
        return order;
    });
}
// =========================================================
// 2️⃣ VERIFY PAYMENT SIGNATURE (MOST IMPORTANT)
// =========================================================
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
        const order = yield markOrderPaid(razorpay_order_id, razorpay_payment_id, razorpay_signature, req);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        res.json({ success: true, order });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.verifyPayment = verifyPayment;
// =========================================================
// RAZORPAY WEBHOOK — server-to-server payment confirmation
// =========================================================
// Configure in Razorpay Dashboard > Settings > Webhooks: URL
// https://lapshark.com/api/orders/webhook, events "payment.captured" (and
// optionally "order.paid"), secret = RAZORPAY_WEBHOOK_SECRET below.
//
// Exists because verifyPayment alone has a gap: it only runs if the
// customer's browser successfully calls it after Razorpay's checkout.js
// reports success. If the tab closes, the connection drops, or that JS
// callback fails for any reason right after a real successful charge, the
// order was left stuck "Pending" forever with no way to notice the
// customer had actually paid. This route is Razorpay's own server telling
// us directly, independent of the customer's browser.
const razorpayWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const signature = req.headers["x-razorpay-signature"];
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        const rawBody = req.rawBody;
        if (!secret) {
            console.error("RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook");
            return res.status(500).json({ message: "Webhook not configured" });
        }
        if (!signature || !rawBody) {
            return res.status(400).json({ message: "Missing signature or body" });
        }
        // Verified against the exact raw bytes Razorpay sent — see server.ts's
        // express.json({ verify }) for why rawBody exists.
        const expectedSignature = crypto_1.default.createHmac("sha256", secret).update(rawBody).digest("hex");
        if (expectedSignature !== signature) {
            return res.status(400).json({ message: "Invalid webhook signature" });
        }
        const event = req.body.event;
        if (event === "payment.captured" || event === "order.paid") {
            const paymentEntity = (_b = (_a = req.body.payload) === null || _a === void 0 ? void 0 : _a.payment) === null || _b === void 0 ? void 0 : _b.entity;
            const orderEntity = (_d = (_c = req.body.payload) === null || _c === void 0 ? void 0 : _c.order) === null || _d === void 0 ? void 0 : _d.entity;
            const razorpayOrderId = (paymentEntity === null || paymentEntity === void 0 ? void 0 : paymentEntity.order_id) || (orderEntity === null || orderEntity === void 0 ? void 0 : orderEntity.id);
            const razorpayPaymentId = paymentEntity === null || paymentEntity === void 0 ? void 0 : paymentEntity.id;
            if (razorpayOrderId) {
                yield markOrderPaid(razorpayOrderId, razorpayPaymentId, undefined, req);
            }
        }
        // Razorpay expects a fast 2xx for any event we don't act on too —
        // otherwise it retries the same delivery on a backoff schedule.
        return res.status(200).json({ received: true });
    }
    catch (err) {
        console.error("Webhook error:", err);
        // Still 200: our own bug here shouldn't make Razorpay hammer retries
        // for an event that already failed once — errors are visible in logs.
        return res.status(200).json({ received: true, error: true });
    }
});
exports.razorpayWebhook = razorpayWebhook;
// =========================================================
// EKART SHIPMENT WEBHOOK — courier status updates
// =========================================================
// Same shape as razorpayWebhook above: Ekart's own server calling us, so no
// `protect` — authenticated by verifying its signature against the raw body
// instead (server.ts's express.json({ verify }) captures req.rawBody for
// this). ⚠️ Header name and payload field names (awb/status) are placeholders
// pending Ekart's actual webhook doc — check both against it before relying
// on this in production; see services/ekart.ts's header comment for why.
const EKART_STATUS_MAP = {
    picked_up: "Shipped",
    in_transit: "Shipped",
    out_for_delivery: "Out for Delivery",
    delivered: "Delivered",
    rto: "RTO",
    rto_delivered: "RTO",
};
const shipmentWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const signature = req.headers["x-ekart-signature"];
        const secret = process.env.EKART_WEBHOOK_SECRET;
        const rawBody = req.rawBody;
        if (!secret) {
            console.error("EKART_WEBHOOK_SECRET not configured — rejecting webhook");
            return res.status(500).json({ message: "Webhook not configured" });
        }
        if (!signature || !rawBody) {
            return res.status(400).json({ message: "Missing signature or body" });
        }
        const expectedSignature = crypto_1.default.createHmac("sha256", secret).update(rawBody).digest("hex");
        if (expectedSignature !== signature) {
            return res.status(400).json({ message: "Invalid webhook signature" });
        }
        const awb = req.body.awb || req.body.waybill;
        const courierStatus = req.body.status;
        const mappedStatus = EKART_STATUS_MAP[courierStatus];
        if (awb && mappedStatus) {
            const update = {
                status: mappedStatus,
                "shipment.courierStatus": courierStatus,
            };
            if (mappedStatus === "Delivered")
                update["shipment.deliveredAt"] = new Date();
            const order = yield Order_1.default.findOneAndUpdate({ "shipment.awb": awb }, update, { new: true });
            if (order) {
                yield (0, notifyByKey_1.notifyByKey)("shipment.updated", {
                    entityId: order.orderId,
                    payload: { status: mappedStatus, awb },
                    req,
                });
            }
        }
        // Same reasoning as razorpayWebhook: fast 2xx for events we don't act on
        // too, so Ekart doesn't retry-storm a delivery we've already seen.
        return res.status(200).json({ received: true });
    }
    catch (err) {
        console.error("Ekart webhook error:", err);
        return res.status(200).json({ received: true, error: true });
    }
});
exports.shipmentWebhook = shipmentWebhook;
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
    var _a;
    try {
        const order = yield Order_1.default.findOne({ orderId: req.params.id });
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        // protect only confirms *someone* is logged in — without this, any
        // customer could read any other customer's order by guessing its id.
        const reqUser = req.user;
        if ((reqUser === null || reqUser === void 0 ? void 0 : reqUser.role) !== "admin" && ((_a = order.userId) === null || _a === void 0 ? void 0 : _a.toString()) !== (reqUser === null || reqUser === void 0 ? void 0 : reqUser.id)) {
            return res.status(403).json({ message: "Not authorized to view this order" });
        }
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
    var _a, _b, _c, _d, _e, _f;
    try {
        const { status } = req.body;
        const { id } = req.params; // this is orderId, not _id
        const order = yield Order_1.default.findOne({ orderId: id }); // ⭐ FIND USING orderId
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        // Moving to Shipped books the actual courier shipment — gated on no AWB
        // existing yet so re-clicking "Shipped" (or the admin re-saving) doesn't
        // book a second one for the same order.
        if (status === "Shipped" && !((_a = order.shipment) === null || _a === void 0 ? void 0 : _a.awb)) {
            const productIds = order.items.map((i) => i.productId);
            const products = yield Product_1.default.find({ _id: { $in: productIds } });
            // ponytail: sums real per-item weight but packs the whole order into
            // one box sized to the single largest item's dims rather than actually
            // bin-packing — fine for the common 1-2 laptop order, revisit if
            // multi-item orders needing real box-packing become common.
            let totalWeightKg = 0;
            let dims = { length: 35, width: 25, height: 8 };
            let maxVolume = 0;
            for (const item of order.items) {
                const product = products.find((p) => { var _a; return p._id.toString() === ((_a = item.productId) === null || _a === void 0 ? void 0 : _a.toString()); });
                const weight = (_b = product === null || product === void 0 ? void 0 : product.weightKg) !== null && _b !== void 0 ? _b : 2.5;
                totalWeightKg += weight * item.quantity;
                const l = (_c = product === null || product === void 0 ? void 0 : product.lengthCm) !== null && _c !== void 0 ? _c : 35, w = (_d = product === null || product === void 0 ? void 0 : product.widthCm) !== null && _d !== void 0 ? _d : 25, h = (_e = product === null || product === void 0 ? void 0 : product.heightCm) !== null && _e !== void 0 ? _e : 8;
                const volume = l * w * h;
                if (volume > maxVolume) {
                    maxVolume = volume;
                    dims = { length: l, width: w, height: h };
                }
            }
            try {
                const shipment = yield ekart.createShipment({
                    orderId: order.orderId,
                    customerName: order.customerName,
                    shippingAddress: order.shippingAddress,
                    total: order.total,
                    paymentMethod: order.paymentMethod,
                    codAmount: order.total - (order.advanceAmount || 0),
                    items: order.items,
                    totalWeightKg,
                    dimsCm: dims,
                });
                order.shipment = {
                    awb: shipment.awb,
                    labelUrl: shipment.labelUrl,
                    trackingUrl: shipment.trackingUrl,
                    shippedAt: new Date(),
                };
            }
            catch (shipErr) {
                console.error("Ekart shipment creation failed:", ((_f = shipErr.response) === null || _f === void 0 ? void 0 : _f.data) || shipErr.message);
                return res.status(502).json({
                    success: false,
                    message: "Could not create courier shipment. Order status left unchanged — retry once the courier issue is resolved.",
                });
            }
        }
        order.status = status;
        if (status === "Delivered" && order.shipment)
            order.shipment.deliveredAt = new Date();
        yield order.save();
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
    var _a, _b, _c;
    try {
        const order = yield Order_1.default.findById(req.params.id);
        if (!order)
            return res.status(404).json({ message: "Order not found" });
        const reqUser = req.user;
        if ((reqUser === null || reqUser === void 0 ? void 0 : reqUser.role) !== "admin" && ((_a = order.userId) === null || _a === void 0 ? void 0 : _a.toString()) !== (reqUser === null || reqUser === void 0 ? void 0 : reqUser.id)) {
            return res.status(403).json({ message: "Not authorized to cancel this order" });
        }
        // Idempotent: re-cancelling an already-cancelled order (double-click,
        // retried request) must not re-fire the courier cancel or, worse,
        // refund the advance a second time.
        if (order.status === "Cancelled") {
            return res.json({ success: true, order });
        }
        if ((_b = order.shipment) === null || _b === void 0 ? void 0 : _b.awb) {
            try {
                yield ekart.cancelShipment(order.shipment.awb);
            }
            catch (err) {
                // Best-effort: a courier-side cancel failure (already picked up, API
                // hiccup) shouldn't block cancelling the order on our side — logged
                // so it can be cancelled manually via the Ekart dashboard if needed.
                console.error("Ekart shipment cancel failed:", ((_c = err.response) === null || _c === void 0 ? void 0 : _c.data) || err.message);
            }
        }
        // COD advance refund — the ₹500 (or less, see createOrder's small-order
        // edge case) already charged via Razorpay to confirm the order. A fully
        // prepaid (non-COD) order is the whole order value, not a small
        // pre-payment, and isn't auto-refunded here — that stays a manual
        // Razorpay-dashboard action, unchanged from before.
        if (order.paymentMethod === "COD" && order.paymentStatus === "Paid" && order.advanceAmount > 0 && order.razorpayPaymentId) {
            try {
                const refund = yield razorpay.payments.refund(order.razorpayPaymentId, {
                    amount: order.advanceAmount * 100,
                    speed: "optimum",
                });
                order.refund = {
                    id: refund.id,
                    amount: order.advanceAmount,
                    status: refund.status,
                    refundedAt: new Date(),
                };
                order.paymentStatus = "Refunded";
            }
            catch (err) {
                // Not best-effort-and-forget like the shipment cancel above: this is
                // money that didn't come back, so it's recorded as a failed refund
                // (surfaced in the admin order view) rather than silently left as
                // "Paid", which would read as nothing being owed to the customer.
                console.error("Razorpay advance refund failed:", err.error || err.message);
                order.refund = { amount: order.advanceAmount, status: "failed" };
            }
        }
        order.status = "Cancelled";
        if (order.paymentStatus !== "Refunded")
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
    var _a;
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
        // Server-side `generate_lead` event — the one real EMI-interest signal,
        // since the EMI banner is a page-level offer, not tied to a product.
        try {
            yield BehaviorEvent_1.default.create({
                eventName: "generate_lead",
                visitorId: null,
                sessionId: null,
                properties: { phone, source: "emi_banner" },
                source: "server",
            });
        }
        catch (err) {
            console.error("generate_lead tracking event failed:", err.message);
        }
        // Meta CAPI — server-only, no browser Pixel counterpart for this one
        // (the EMI form has no client-side trackEvent call), so there's nothing
        // to dedupe against and no eventId needed.
        try {
            yield (0, metaCapi_1.sendCapiEvent)({
                eventName: "Lead",
                eventSourceUrl: "https://lapshark.com/",
                userData: Object.assign({ phone, ip: req.ip, userAgent: req.headers["user-agent"] }, (0, metaCapi_1.parseFbCookies)(req.headers.cookie)),
            });
        }
        catch (err) {
            console.error("Meta CAPI lead event failed:", ((_a = err.response) === null || _a === void 0 ? void 0 : _a.data) || err.message);
        }
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
