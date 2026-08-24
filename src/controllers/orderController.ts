import { Request, Response } from "express";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();
import Razorpay from "razorpay";
import Order from "../models/Order";
import Product from "../models/Product";
import { sendAdminLoanEnquiryPayload, sendAdminOrderConfirmationPayload, sendOrderConfirmation } from "../services/wa";
import { notifyByKey } from "../services/notifyByKey";
import { LoanEnquiry } from "../models/Enquiry";
import { validateAndComputeCoupon, markCouponUsed } from "./couponController";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY!,
  key_secret: process.env.RAZORPAY_SECRET!,
});


// =========================================================
// 1️⃣ CREATE ORDER (Internal + Razorpay Order)
// =========================================================
export const createOrder = async (req: Request, res: Response) => {
  try {
    const {
      customerName,
      customerEmail,
      items,
      mapLink,
      shippingAddress,
      paymentMethod,
      coupon
    } = req.body;

    const userId = (req as any).user?.id || null;

    // ---- Fetch Products ----
    const productIds = items.map((i: any) => i.productId);
    const products = await Product.find({ _id: { $in: productIds } });

    if (!products.length) {
      return res.status(404).json({ message: "Products not found" });
    }


    // ---- Calculate Total ----
    let total = 0;
    const updatedItems = items.map((item: any) => {
      const product = products.find(
        (p) => p._id.toString() === item.productId
      );
      if (!product) throw new Error("Product not found");

      // Config pricing
      const ramOption = product.configOptions.ram.find(
        (r: any) => r.value === item.config.ram
      );

      const storageOption = product.configOptions.storage.find(
        (s: any) => s.value === item.config.storage
      );

      const warrantyOption = product.configOptions.warranty.find(
        (w: any) => w.value === item.config.warranty
      );

      const configCost =
        (ramOption?.price || 0) +
        (storageOption?.price || 0) +
        (warrantyOption?.price || 0);


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
    let appliedCouponCode: string | null = null;
    if (coupon) {
      const couponResult = await validateAndComputeCoupon(coupon, total);
      if (!couponResult.valid) {
        return res.status(400).json({ message: couponResult.message || "Invalid coupon code" });
      }
      discountAmount = couponResult.discountAmount;
      appliedCouponCode = couponResult.coupon!.code;
      total = couponResult.finalAmount;
    }

    // ---- Create Razorpay Order ----
    const razorpayOrder = await razorpay.orders.create({
      amount: total * 100, // convert to paisa
      currency: "INR",
      receipt: "order_" + Date.now()
    });

    // ---- Save Order in DB ----
    const newOrder = await Order.create({
      orderId: razorpayOrder.id,
      customerName,
      customerEmail,
      userId,
      date: new Date().toISOString(),   // FIXED
      total,
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
      amount: total * 100,
      key: process.env.RAZORPAY_KEY
    });
  } catch (err: any) {
    console.error("ORDER ERROR:", err);
    return res
      .status(500)
      .json({ success: false, error: err.message || "Server Error" });
  }
};



// =========================================================
// 2️⃣ VERIFY PAYMENT SIGNATURE (MOST IMPORTANT)
// =========================================================
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    // 1️⃣ Verify Razorpay Signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET!)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid Signature",
      });
    }

    // 2️⃣ Fetch Order + Populate User
    const order = await Order.findOne({ orderId: razorpay_order_id }).populate("userId");

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Idempotency: a retried/duplicated call with the same (still valid)
    // signature would otherwise re-send both WhatsApp confirmations and
    // double-count the coupon's usedCount on every repeat.
    if (order.paymentStatus === "Paid") {
      return res.json({ success: true, order });
    }

    // Type fix here:
    const user = order.userId as any;

    const customerName = user.name;
    const customerPhone = user.mobile;

    // 3️⃣ Update the order payment status
    order.paymentStatus = "Paid";
    order.status = "Processing";
    order.razorpayPaymentId = razorpay_payment_id;
    order.razorpaySignature = razorpay_signature;
    order.paidAt = new Date();
    await order.save();

    // Coupon only actually counts as "used" once payment is confirmed —
    // createOrder validates it, but abandoning the Razorpay popup before
    // paying shouldn't burn a redemption.
    if (order.coupon) {
      await markCouponUsed(order.coupon);
    }

    // 5️⃣ Send WhatsApp Order Confirmation
    await sendOrderConfirmation(customerPhone, customerName, razorpay_order_id);
    await sendAdminOrderConfirmationPayload(customerName, customerPhone, razorpay_order_id, order.total as any, order.date as any);

    // 🔔 EVENT EMITTED HERE
    await notifyByKey("payment.success", {
      entityId: order.orderId,
      payload: {
        amount: order.total,
        paymentId: razorpay_payment_id
      },
      req
    });

    // 6️⃣ Return the updated order 
    res.json({ success: true, order });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};


// =========================================================
// 3️⃣ GET USER ORDERS
// =========================================================
export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const orders = await Order.find({ userId }).sort({ createdAt: -1 });

    res.json({ success: true, orders });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};


// =========================================================
// 4️⃣ GET ORDER BY ID
// =========================================================
export const getOrderById = async (req: Request, res: Response) => {
  try {
    const order = await Order.findOne({ orderId: req.params.id });

    if (!order) return res.status(404).json({ message: "Order not found" });

    // protect only confirms *someone* is logged in — without this, any
    // customer could read any other customer's order by guessing its id.
    const reqUser = (req as any).user;
    if (reqUser?.role !== "admin" && order.userId?.toString() !== reqUser?.id) {
      return res.status(403).json({ message: "Not authorized to view this order" });
    }

    res.json({ success: true, order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};


// =========================================================
// 5️⃣ ADMIN: GET ALL ORDERS
// =========================================================
export const adminGetAllOrders = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });

    res.json({ success: true, orders });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};


// =========================================================
// 6️⃣ UPDATE ORDER STATUS 
// (Processing → Shipped → Delivered → Cancelled)
// =========================================================
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const { id } = req.params; // this is orderId, not _id

    const order = await Order.findOneAndUpdate(
      { orderId: id },   // ⭐ FIND USING orderId
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};


// =========================================================
// 7️⃣ CANCEL ORDER
// =========================================================
export const cancelOrder = async (req: Request, res: Response) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) return res.status(404).json({ message: "Order not found" });

    const reqUser = (req as any).user;
    if (reqUser?.role !== "admin" && order.userId?.toString() !== reqUser?.id) {
      return res.status(403).json({ message: "Not authorized to cancel this order" });
    }

    order.status = "Cancelled";
    order.paymentStatus = "Failed";

    await order.save();

    res.json({ success: true, order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};


export const sendLoanEnquiry = async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone is required" });
    }

    const existing = await LoanEnquiry.findOne({ phone });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Loan enquiry already submitted",
      });
    }

    await LoanEnquiry.create({ phone });

    await sendAdminLoanEnquiryPayload(phone);

    res.json({
      success: true,
      message: "Loan enquiry submitted successfully",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};