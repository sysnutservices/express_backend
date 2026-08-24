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
// Shared by verifyPayment (client, right after Razorpay's checkout.js
// succeeds) and razorpayWebhook (Razorpay's own server calling back,
// independent of whether the customer's browser ever managed to). Both are
// legitimate ways to learn a payment succeeded, and either can arrive
// first — the findOneAndUpdate's paymentStatus:{$ne:"Paid"} filter is what
// makes only one of them actually run the side effects below, atomically,
// instead of a read-then-write race letting both send duplicate WhatsApp
// confirmations and double-count the coupon's usedCount.
// =========================================================
async function markOrderPaid(razorpayOrderId: string, razorpayPaymentId: string, razorpaySignature: string | undefined, req: Request) {
  const update: Record<string, unknown> = {
    paymentStatus: "Paid",
    status: "Processing",
    razorpayPaymentId,
    paidAt: new Date(),
  };
  if (razorpaySignature) update.razorpaySignature = razorpaySignature;

  const order = await Order.findOneAndUpdate(
    { orderId: razorpayOrderId, paymentStatus: { $ne: "Paid" } },
    update,
    { new: true }
  ).populate("userId");

  if (!order) {
    // Either no such order, or it was already marked Paid by whichever of
    // verifyPayment/the webhook got here first — side effects already ran
    // there either way, so this call is done.
    return await Order.findOne({ orderId: razorpayOrderId });
  }

  const user = order.userId as any;
  const customerName = user?.name;
  const customerPhone = user?.mobile;

  if (order.coupon) {
    await markCouponUsed(order.coupon);
  }

  if (customerPhone) {
    await sendOrderConfirmation(customerPhone, customerName, razorpayOrderId);
    await sendAdminOrderConfirmationPayload(customerName, customerPhone, razorpayOrderId, order.total as any, order.date as any);
  }

  await notifyByKey("payment.success", {
    entityId: order.orderId,
    payload: { amount: order.total, paymentId: razorpayPaymentId },
    req,
  });

  return order;
}

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

    const order = await markOrderPaid(razorpay_order_id, razorpay_payment_id, razorpay_signature, req);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, order });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

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
export const razorpayWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const rawBody: Buffer | undefined = (req as any).rawBody;

    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET not configured — rejecting webhook");
      return res.status(500).json({ message: "Webhook not configured" });
    }
    if (!signature || !rawBody) {
      return res.status(400).json({ message: "Missing signature or body" });
    }

    // Verified against the exact raw bytes Razorpay sent — see server.ts's
    // express.json({ verify }) for why rawBody exists.
    const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (expectedSignature !== signature) {
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    const event = req.body.event;
    if (event === "payment.captured" || event === "order.paid") {
      const paymentEntity = req.body.payload?.payment?.entity;
      const orderEntity = req.body.payload?.order?.entity;
      const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
      const razorpayPaymentId = paymentEntity?.id;

      if (razorpayOrderId) {
        await markOrderPaid(razorpayOrderId, razorpayPaymentId, undefined, req);
      }
    }

    // Razorpay expects a fast 2xx for any event we don't act on too —
    // otherwise it retries the same delivery on a backoff schedule.
    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("Webhook error:", err);
    // Still 200: our own bug here shouldn't make Razorpay hammer retries
    // for an event that already failed once — errors are visible in logs.
    return res.status(200).json({ received: true, error: true });
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