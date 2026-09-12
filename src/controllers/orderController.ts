import { Request, Response } from "express";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();
import Razorpay from "razorpay";
import Order from "../models/Order";
import Product from "../models/Product";
import { sendAdminLoanEnquiryPayload, sendAdminOrderConfirmationPayload, sendOrderConfirmation, sendShipmentConfirmation, sendDeliveryConfirmation } from "../services/wa";
import { notifyByKey } from "../services/notifyByKey";
import { LoanEnquiry } from "../models/Enquiry";
import { validateAndComputeCoupon, markCouponUsed } from "./couponController";
import { calculateProductPrice } from "../utils/pricing";
import * as ekart from "../services/ekart";
import BehaviorEvent from "../models/BehaviorEvent";
import { sendCapiEvent, parseFbCookies } from "../services/metaCapi";
import { nextSeq } from "../models/Counter";
import { normalizeSerialNumber, findSerialConflict } from "../utils/serialNumber";

// Customer-facing order number: LS-YYYYMMDD-NN, distinct from Razorpay's own
// order_xxxxxxxxxxxxxx id (still kept as razorpayOrderId, for the checkout
// widget and Razorpay-side lookups). Per-day sequence, atomic via Counter's
// $inc — never repeats even under concurrent checkouts.
async function generateOrderId(): Promise<string> {
  const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
  const seq = await nextSeq(`order-${dateKey}`);
  return `LS-${dateKey}-${String(seq).padStart(2, "0")}`;
}

// Same landmine as services/imagekit.ts: Razorpay's constructor throws
// synchronously on a missing key_id, and this module is required at server
// startup (routes/api.ts), so a blank/missing RAZORPAY_KEY has twice now
// taken down the entire API — login, browsing, admin panel, everything, not
// just checkout — in a crash-restart loop. Placeholder fallback keeps
// construction from throwing; the actual checkout/refund calls that need a
// real key still fail normally (caught in their own route handlers) if this
// was never really configured.
if (!process.env.RAZORPAY_KEY || !process.env.RAZORPAY_SECRET) {
  console.error("RAZORPAY_KEY/RAZORPAY_SECRET not set — checkout and refunds will fail until configured, but the rest of the API stays up.");
}
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY || "rzp_unconfigured",
  key_secret: process.env.RAZORPAY_SECRET || "unconfigured",
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
export const checkPincodeServiceability = async (req: Request, res: Response) => {
  try {
    const { pincode } = req.params;
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: "Invalid pincode" });
    }
    const result = await ekart.checkServiceability(pincode);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

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
      coupon,
      metaEventId
    } = req.body;

    const userId = (req as any).user?.id || null;

    // ---- Fetch Products ----
    const productIds = items.map((i: any) => i.productId);
    const products = await Product.find({ _id: { $in: productIds } });

    if (!products.length) {
      return res.status(404).json({ message: "Products not found" });
    }


    // ---- Calculate Total ----
    // Extra Product Offer + price-change detection: cart/checkout display
    // prices are computed client-side from whatever product data was last
    // fetched, which can go stale if an offer expires or is edited while the
    // item sits in the cart. This is the actual charge, so it always
    // recomputes from the live product — never trusts item.finalPrice from
    // the request — and if the client told us what it expected to pay
    // (expectedFinalPrice, sent by the checkout page's own live price calc)
    // and that no longer matches, the order is rejected with the corrected
    // price instead of silently charging the new amount (spec: never
    // silently charge a different amount than what the customer saw last).
    let total = 0;
    let priceChanged = false;
    const priceChanges: Array<{ productId: string; title: string; oldPrice: number; newPrice: number }> = [];
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

      // Extra Product Offer applies to the base selling price only, not to
      // config addon costs — same split productController/ProductCard use.
      const priced = calculateProductPrice(product.finalPrice, product.extraOffer);
      const finalPrice = priced.finalPrice + configCost;
      const subtotal = finalPrice * item.quantity;

      total += subtotal;

      if (typeof item.expectedFinalPrice === "number" && Math.abs(item.expectedFinalPrice - finalPrice) >= 1) {
        priceChanged = true;
        priceChanges.push({ productId: item.productId, title: product.title, oldPrice: item.expectedFinalPrice, newPrice: finalPrice });
      }

      return {
        productId: item.productId,
        title: product.title,
        quantity: item.quantity,
        finalPrice,
        image: product.image,
        storage: storageOption,
        warranty: warrantyOption,
        selectedConfig: item.config,
        originalPrice: priced.offer ? priced.sellingPrice + configCost : undefined,
        extraOfferDiscount: priced.offer?.discountAmount,
        extraOfferLabel: priced.offer?.offerLabel,
      };
    });

    if (priceChanged) {
      return res.status(409).json({
        success: false,
        priceChanged: true,
        message: "One or more product offers have changed since you added them to your cart. Prices have been updated — please review and confirm.",
        priceChanges,
      });
    }

    // Shipping eligibility is based on the item subtotal, same as the
    // checkout page's own display calc — capture it before the coupon block
    // below overwrites `total` with the discounted amount.
    const itemSubtotal = total;

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

    // ---- Shipping ----
    // This is the authoritative copy — what's actually charged. The
    // frontend's matching copy (display only) lives in one place, Lapshark's
    // lib/pricing.ts (SHIPPING_THRESHOLD/getShippingCost), shared by Cart
    // and Checkout instead of each hardcoding it — separate repos/runtimes,
    // so a literal shared module isn't possible; keep both in sync by hand
    // if the rate/threshold ever changes. (createOrder didn't charge
    // shipping at all until this was added — every order was silently
    // undercharged by the full amount checkout displayed.)
    // ponytail: flat rate/threshold, not configurable or per-pincode — make
    // it a real shipping-rate lookup if that's ever needed.
    const SHIPPING_THRESHOLD = 10000;
    const SHIPPING_FLAT_RATE = 500;
    const shippingCost = itemSubtotal > SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT_RATE;
    total += shippingCost;

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
    const razorpayOrder = await razorpay.orders.create({
      amount: amountToCharge * 100, // convert to paisa
      currency: "INR",
      receipt: "order_" + Date.now()
    });

    // ---- Save Order in DB ----
    const newOrder = await Order.create({
      orderId: await generateOrderId(),
      customerName,
      customerEmail,
      userId,
      date: new Date().toISOString(),   // FIXED
      total,
      shippingCost,
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
    { razorpayOrderId, paymentStatus: { $ne: "Paid" } },
    update,
    { new: true }
  ).populate("userId");

  if (!order) {
    // Either no such order, or it was already marked Paid by whichever of
    // verifyPayment/the webhook got here first — side effects already ran
    // there either way, so this call is done.
    return await Order.findOne({ razorpayOrderId });
  }

  const user = order.userId as any;
  const customerName = order.customerName || user?.name;
  const customerPhone = user?.mobile;

  if (order.coupon) {
    await markCouponUsed(order.coupon);
  }

  // Best-effort, like the BehaviorEvent/CAPI calls further down in this
  // function: the order is already marked Paid above, so a WhatsApp
  // delivery failure (rate limit, template issue, whatsapp-saas outage)
  // must not fail this whole request — that used to propagate straight up
  // to verifyPayment's catch, which returned 500 and showed the customer
  // "Payment received, confirmation pending... contact support" even
  // though the payment had already gone through and been recorded fine.
  if (customerPhone) {
    try {
      // The human-readable order number (LS-YYYYMMDD-NN), not Razorpay's
      // own order_xxxxxxxxxxxxxx id — that's what a customer should
      // see/quote. order.total is a number — the whatsapp-saas API 400s
      // ("each value in params must be a string") if it isn't stringified
      // first, which is what was actually triggering this in practice.
      await sendOrderConfirmation(customerPhone, customerName, order.orderId);
      await sendAdminOrderConfirmationPayload(customerName, customerPhone, order.orderId, order.total.toLocaleString("en-IN"), order.date);
    } catch (err: any) {
      console.error("Order confirmation WhatsApp message(s) failed:", err.response?.data || err.message);
    }
  }

  await notifyByKey("payment.success", {
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
    await BehaviorEvent.create({
      eventName: "purchase",
      visitorId: null,
      sessionId: null,
      userId: order.userId || undefined,
      properties: {
        orderId: order.orderId,
        total: order.total,
        paymentMethod: order.paymentMethod,
        itemCount: order.items?.length || 0,
        // Per-product breakdown — lets the admin Product Views page compute
        // real purchase counts per product, not just views/add-to-cart.
        // Orders are small (a handful of line items), so this stays well
        // under the 2KB properties cap ingestEvent enforces on the client
        // path — this write goes straight to Mongo, bypassing that check
        // entirely, but the size is inherently bounded by cart size anyway.
        items: (order.items || []).map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
      },
      source: "server",
    });
  } catch (err: any) {
    console.error("purchase tracking event failed:", err.message);
  }

  // Meta Conversions API — server truth for the Purchase conversion. Uses
  // the same metaEventId the browser's Pixel Purchase call carries (set at
  // checkout, see CheckoutContent.tsx) so Meta dedupes the two into one
  // conversion instead of double-counting. No-ops entirely if
  // META_PIXEL_ID/META_CAPI_ACCESS_TOKEN aren't configured — never blocks
  // payment confirmation on a failure here.
  try {
    await sendCapiEvent({
      eventName: "Purchase",
      eventId: order.metaEventId,
      eventSourceUrl: `https://lapshark.com/order-success/${order.orderId}`,
      userData: {
        email: order.customerEmail || undefined,
        phone: order.shippingAddress?.phone,
        ip: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
        // Only present when markOrderPaid runs off verifyPayment (a real
        // browser request) — absent on the webhook path, which is
        // Razorpay's server calling us with no cookie jar of its own.
        // parseFbCookies(undefined) just returns {}, so this degrades
        // gracefully either way.
        ...parseFbCookies(req.headers.cookie),
      },
      customData: {
        value: order.total,
        currency: "INR",
        contents: (order.items || []).map((i: any) => ({ id: i.productId, quantity: i.quantity })),
      },
    });
  } catch (err: any) {
    console.error("Meta CAPI purchase event failed:", err.response?.data || err.message);
  }

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
// EKART SHIPMENT WEBHOOK — courier status updates
// =========================================================
// Same shape as razorpayWebhook above: Ekart's own server calling us, so no
// `protect` — authenticated by verifying its signature against the raw body
// instead (server.ts's express.json({ verify }) captures req.rawBody for
// this). ⚠️ Header name and payload field names (awb/status) are placeholders
// pending Ekart's actual webhook doc — check both against it before relying
// on this in production; see services/ekart.ts's header comment for why.
const EKART_STATUS_MAP: Record<string, string> = {
  picked_up: "Shipped",
  in_transit: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  rto: "RTO",
  rto_delivered: "RTO",
};

export const shipmentWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-ekart-signature"] as string | undefined;
    const secret = process.env.EKART_WEBHOOK_SECRET;
    const rawBody: Buffer | undefined = (req as any).rawBody;

    // TEMPORARY — remove once a real event confirms the actual signature
    // header/scheme. Ekart's webhook doc names no header, only that the
    // registered `secret` "hashes the webhook post body ... for calculating
    // h-mac" — logs every hit (still fail-closed below either way) so the
    // first real event teaches us the true format instead of guessing again.
    console.log("Ekart webhook received — headers:", JSON.stringify(req.headers), "body:", rawBody?.toString());

    if (!secret) {
      console.error("EKART_WEBHOOK_SECRET not configured — rejecting webhook");
      return res.status(500).json({ message: "Webhook not configured" });
    }
    if (!signature || !rawBody) {
      return res.status(400).json({ message: "Missing signature or body" });
    }

    const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (expectedSignature !== signature) {
      return res.status(400).json({ message: "Invalid webhook signature" });
    }

    // Real field names, per Ekart's track_updated webhook doc: `id` is
    // their own tracking id (what we store as shipment.awb — same value
    // createShipment's response mapped it from), `wbn` is the vendor
    // waybill (a different, courier-internal number, not what we key on).
    const awb = req.body.id;
    const courierStatus = req.body.status;
    const mappedStatus = EKART_STATUS_MAP[courierStatus];

    if (awb && mappedStatus) {
      const update: Record<string, unknown> = {
        status: mappedStatus,
        "shipment.courierStatus": courierStatus,
      };
      if (mappedStatus === "Delivered") update["shipment.deliveredAt"] = new Date();

      // Same idempotency shape as markOrderPaid's paymentStatus guard: a
      // repeat/duplicate Delivered event for an order already marked
      // Delivered is a no-op instead of re-sending the WhatsApp message.
      const filter: Record<string, unknown> = { "shipment.awb": awb };
      if (mappedStatus === "Delivered") filter.status = { $ne: "Delivered" };

      const order = await Order.findOneAndUpdate(filter, update, { new: true });
      if (order) {
        await notifyByKey("shipment.updated", {
          entityId: order.orderId,
          payload: { status: mappedStatus, awb },
          req,
        });
        if (mappedStatus === "Delivered") {
          try {
            await sendDeliveryConfirmation(order.shippingAddress.phone, order.customerName, order.orderId);
          } catch (waErr: any) {
            console.error("Delivery confirmation WhatsApp message failed:", waErr.response?.data || waErr.message);
          }
        }
      }
    }

    // Same reasoning as razorpayWebhook: fast 2xx for events we don't act on
    // too, so Ekart doesn't retry-storm a delivery we've already seen.
    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error("Ekart webhook error:", err);
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

    const order = await Order.findOne({ orderId: id }); // ⭐ FIND USING orderId
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // Moving to Shipped books the actual courier shipment — gated on no AWB
    // existing yet so re-clicking "Shipped" (or the admin re-saving) doesn't
    // book a second one for the same order.
    if (status === "Shipped" && !order.shipment?.awb) {
      const productIds = order.items.map((i: any) => i.productId);
      const products = await Product.find({ _id: { $in: productIds } });

      // ponytail: sums real per-item weight but packs the whole order into
      // one box sized to the single largest item's dims rather than actually
      // bin-packing — fine for the common 1-2 laptop order, revisit if
      // multi-item orders needing real box-packing become common.
      let totalWeightKg = 0;
      let dims = { length: 35, width: 25, height: 8 };
      let maxVolume = 0;
      for (const item of order.items as any[]) {
        const product = products.find((p) => p._id.toString() === item.productId?.toString());
        const weight = product?.weightKg ?? 2.5;
        totalWeightKg += weight * item.quantity;
        const l = product?.lengthCm ?? 35, w = product?.widthCm ?? 25, h = product?.heightCm ?? 8;
        const volume = l * w * h;
        if (volume > maxVolume) {
          maxVolume = volume;
          dims = { length: l, width: w, height: h };
        }
      }

      try {
        const shipment = await ekart.createShipment({
          orderId: order.orderId,
          customerName: order.customerName,
          shippingAddress: order.shippingAddress as any,
          total: order.total,
          paymentMethod: order.paymentMethod,
          codAmount: order.total - (order.advanceAmount || 0),
          items: order.items as any,
          totalWeightKg,
          dimsCm: dims,
        });
        order.shipment = {
          awb: shipment.awb,
          labelUrl: shipment.labelUrl,
          trackingUrl: shipment.trackingUrl,
          shippedAt: new Date(),
        };

        // Best-effort, same reasoning as the payment-confirmation WhatsApp
        // sends: the shipment is already booked with Ekart at this point, so
        // a WhatsApp delivery hiccup must not fail the status update itself.
        try {
          await sendShipmentConfirmation(
            order.shippingAddress.phone,
            order.customerName,
            order.orderId,
            shipment.awb,
            shipment.trackingUrl || ""
          );
        } catch (waErr: any) {
          console.error("Shipment confirmation WhatsApp message failed:", waErr.response?.data || waErr.message);
        }
      } catch (shipErr: any) {
        console.error("Ekart shipment creation failed:", shipErr.response?.data || shipErr.message);
        return res.status(502).json({
          success: false,
          message: "Could not create courier shipment. Order status left unchanged — retry once the courier issue is resolved.",
        });
      }
    }

    // Captured before the mutation below — only send on the actual
    // transition into Delivered, not on a re-save that's already Delivered
    // (matches shipmentWebhook's $ne guard for the same case).
    const wasAlreadyDelivered = order.status === "Delivered";

    order.status = status;
    if (status === "Delivered" && order.shipment) order.shipment.deliveredAt = new Date();
    await order.save();

    if (status === "Delivered" && !wasAlreadyDelivered) {
      try {
        await sendDeliveryConfirmation(order.shippingAddress.phone, order.customerName, order.orderId);
      } catch (waErr: any) {
        console.error("Delivery confirmation WhatsApp message failed:", waErr.response?.data || waErr.message);
      }
    }

    res.json({ success: true, order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// =========================================================
// Order-item serial number — set during fulfillment/dispatch, not at order
// creation (a real unit isn't picked/assigned to the order yet at checkout
// time). Addressed by the item subdocument's own Mongoose _id rather than
// array index, since index isn't stable to rely on as an identifier.
// Overwrite protection is deliberately left to the admin UI (it requires an
// explicit "Edit" action before an already-assigned field becomes
// submittable again) rather than a second confirmation flag here — this
// endpoint itself will happily replace an existing value if called, exactly
// like updateOrderStatus already does for order.status.
// =========================================================
export const setItemSerialNumber = async (req: Request, res: Response) => {
  try {
    const { id, itemId } = req.params; // id = orderId (human), not _id
    const serialNumber = normalizeSerialNumber(req.body.serialNumber);

    if (!serialNumber) {
      return res.status(400).json({ success: false, message: "Serial number is required" });
    }

    const order = await Order.findOne({ orderId: id });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const item = (order.items as any).id(itemId);
    if (!item) {
      return res.status(404).json({ success: false, message: "Order item not found" });
    }

    // Narrow candidates via the DB (cheap — this exact serial is rare), then
    // let the pure helper decide precisely which item actually owns it.
    // .lean() leaves each item's _id as a real ObjectId, not a string — has
    // to be stringified here or it can never string-equal itemId (which
    // comes from the URL as a string), making every match look like a
    // conflict, including a same-item re-save of its own unchanged value.
    const rawCandidates = await Order.find({ "items.serialNumber": serialNumber })
      .select("orderId items._id items.serialNumber")
      .lean();
    const candidates = rawCandidates.map((o: any) => ({
      orderId: o.orderId,
      items: o.items.map((it: any) => ({ _id: it._id?.toString(), serialNumber: it.serialNumber })),
    }));
    const conflictOrderId = findSerialConflict(candidates, serialNumber, order.orderId, itemId);
    if (conflictOrderId) {
      return res.status(409).json({
        success: false,
        message: `Serial number ${serialNumber} is already assigned to order ${conflictOrderId}`,
      });
    }

    item.serialNumber = serialNumber;
    await order.save();

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

    // Idempotent: re-cancelling an already-cancelled order (double-click,
    // retried request) must not re-fire the courier cancel or, worse,
    // refund the advance a second time.
    if (order.status === "Cancelled") {
      return res.json({ success: true, order });
    }

    if (order.shipment?.awb) {
      try {
        await ekart.cancelShipment(order.shipment.awb);
      } catch (err: any) {
        // Best-effort: a courier-side cancel failure (already picked up, API
        // hiccup) shouldn't block cancelling the order on our side — logged
        // so it can be cancelled manually via the Ekart dashboard if needed.
        console.error("Ekart shipment cancel failed:", err.response?.data || err.message);
      }
    }

    // COD advance refund — the ₹500 (or less, see createOrder's small-order
    // edge case) already charged via Razorpay to confirm the order. A fully
    // prepaid (non-COD) order is the whole order value, not a small
    // pre-payment, and isn't auto-refunded here — that stays a manual
    // Razorpay-dashboard action, unchanged from before.
    if (order.paymentMethod === "COD" && order.paymentStatus === "Paid" && order.advanceAmount > 0 && order.razorpayPaymentId) {
      try {
        const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
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
      } catch (err: any) {
        // Not best-effort-and-forget like the shipment cancel above: this is
        // money that didn't come back, so it's recorded as a failed refund
        // (surfaced in the admin order view) rather than silently left as
        // "Paid", which would read as nothing being owed to the customer.
        console.error("Razorpay advance refund failed:", err.error || err.message);
        order.refund = { amount: order.advanceAmount, status: "failed" };
      }
    }

    order.status = "Cancelled";
    if (order.paymentStatus !== "Refunded") order.paymentStatus = "Failed";

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

    // Server-side `generate_lead` event — the one real EMI-interest signal,
    // since the EMI banner is a page-level offer, not tied to a product.
    try {
      await BehaviorEvent.create({
        eventName: "generate_lead",
        visitorId: null,
        sessionId: null,
        properties: { phone, source: "emi_banner" },
        source: "server",
      });
    } catch (err: any) {
      console.error("generate_lead tracking event failed:", err.message);
    }

    // Meta CAPI — server-only, no browser Pixel counterpart for this one
    // (the EMI form has no client-side trackEvent call), so there's nothing
    // to dedupe against and no eventId needed.
    try {
      await sendCapiEvent({
        eventName: "Lead",
        eventSourceUrl: "https://lapshark.com/",
        userData: {
          phone,
          ip: req.ip,
          userAgent: req.headers["user-agent"] as string | undefined,
          ...parseFbCookies(req.headers.cookie),
        },
      });
    } catch (err: any) {
      console.error("Meta CAPI lead event failed:", err.response?.data || err.message);
    }

    await sendAdminLoanEnquiryPayload(phone);

    res.json({
      success: true,
      message: "Loan enquiry submitted successfully",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
};