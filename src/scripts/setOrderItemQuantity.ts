// One-off correction for an order placed with the wrong quantity (first
// used 2026-10-11: LS-20261010-03 was placed for 2 laptops, the customer
// wanted 1). There's no admin flow for editing an order's items, so this
// does by hand what createOrder would have done with the right quantity:
//
// - total is recomputed the same way createOrder computes it: item subtotal,
//   minus the coupon (a percentage coupon is recomputed on the new subtotal,
//   a fixed one keeps its amount), plus shipping (₹500 at or under ₹10,000).
//   finalPrice per unit is kept as charged, not re-read from the live product.
// - advanceAmount is left alone: that's what was actually paid on Razorpay.
//   The COD cash the courier collects is total - advanceAmount, worked out
//   when the shipment is booked, so it follows the new total.
// - if markOrderPaid already took stock off, the removed units go back.
//
// Refuses orders that are shipped, cancelled, or already have a shipment
// booked: the courier would already hold the old COD amount.
//
// Dry run (prints changes, writes nothing):
//   node dist/scripts/setOrderItemQuantity.js LS-20261010-03 1
// Apply:
//   node dist/scripts/setOrderItemQuantity.js LS-20261010-03 1 --apply
// An order with more than one line item also needs --item <n> (1-based).
import mongoose from "mongoose";
import connectDB from "../config/db";
import Order from "../models/Order";
import Product from "../models/Product";
import Coupon from "../models/Coupon";
import AuditLog from "../models/AuditLog";

const APPLY = process.argv.includes("--apply");
const itemFlag = process.argv.indexOf("--item");
const [orderId, qtyArg] = process.argv
    .slice(2)
    .filter((a, i) => !a.startsWith("--") && (itemFlag < 0 || i + 2 !== itemFlag + 1));
const newQty = Number(qtyArg);

const SHIPPING_THRESHOLD = 10000;
const SHIPPING_FLAT_RATE = 500;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const fail = (msg: string) => {
    throw new Error(msg);
};

const run = async () => {
    if (!orderId || !Number.isInteger(newQty) || newQty < 1) {
        fail("Usage: node dist/scripts/setOrderItemQuantity.js <orderId> <newQuantity> [--item <n>] [--apply]");
    }
    await connectDB();

    const order: any = await Order.findOne({ orderId });
    if (!order) fail(`No order ${orderId}`);

    if (["Shipped", "Out for Delivery", "Delivered", "Cancelled", "RTO"].includes(order.status) || order.shipment?.awb) {
        fail(`${orderId} is ${order.status}${order.shipment?.awb ? ` with shipment ${order.shipment.awb}` : ""} — not safe to change here.`);
    }
    if (order.cancellation?.status === "Requested") fail(`${orderId} has a pending cancellation request — resolve that first.`);

    let index = 0;
    if (order.items.length > 1) {
        const n = itemFlag > -1 ? Number(process.argv[itemFlag + 1]) : NaN;
        if (!Number.isInteger(n) || n < 1 || n > order.items.length) {
            order.items.forEach((it: any, i: number) => console.log(`  --item ${i + 1}: ${it.quantity} x ${it.title}`));
            fail(`${orderId} has ${order.items.length} items — pick one with --item <n>.`);
        }
        index = n - 1;
    }
    const item = order.items[index];
    const oldQty = Number(item.quantity);
    if (newQty === oldQty) fail(`${item.title} is already quantity ${oldQty}.`);
    if (newQty > oldQty) fail(`This only lowers quantities (stock was never checked for ${newQty}).`);

    const subtotal = order.items.reduce(
        (sum: number, it: any, i: number) => sum + it.finalPrice * (i === index ? newQty : it.quantity),
        0
    );

    let couponValue = order.couponValue || 0;
    if (order.coupon && couponValue > 0) {
        const coupon: any = await Coupon.findOne({ code: String(order.coupon).toUpperCase() }).lean();
        if (coupon?.type === "percentage") couponValue = Math.round((subtotal * coupon.value) / 100);
        else if (!coupon) console.log(`  (coupon ${order.coupon} no longer exists — keeping its ${inr(couponValue)} discount)`);
        if (couponValue > subtotal) couponValue = subtotal;
    }

    const shippingCost = subtotal > SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT_RATE;
    const total = subtotal - couponValue + shippingCost;
    const advance = order.advanceAmount || 0;
    if (total < advance) fail(`New total ${inr(total)} is below the ${inr(advance)} already paid — handle this one as a refund.`);

    console.log(`${orderId} — ${order.customerName} (${order.paymentMethod}, ${order.status}/${order.paymentStatus})`);
    console.log(`  ${item.title}`);
    console.log(`  quantity:  ${oldQty} -> ${newQty}  (${inr(item.finalPrice)} each)`);
    console.log(`  coupon:    ${inr(order.couponValue || 0)} -> ${inr(couponValue)}${order.coupon ? ` (${order.coupon})` : ""}`);
    console.log(`  shipping:  ${inr(order.shippingCost || 0)} -> ${inr(shippingCost)}`);
    console.log(`  total:     ${inr(order.total)} -> ${inr(total)}`);
    if (order.paymentMethod === "COD") {
        console.log(`  advance paid: ${inr(advance)} (unchanged)`);
        console.log(`  COD to collect: ${inr(order.total - advance)} -> ${inr(total - advance)}`);
    } else if (order.paymentStatus === "Paid") {
        console.log(`  ⚠ prepaid order: ${inr(order.total - total)} needs refunding on Razorpay separately.`);
    }

    // Stock goes back only for what markOrderPaid actually took off.
    const removed = oldQty - newQty;
    const productId = String(item.productId);
    const deductions: { productId: string; quantity: number }[] = (order.stockDeductions || []).map((d: any) => ({
        productId: d.productId,
        quantity: d.quantity,
    }));
    const deduction = order.stockDeducted ? deductions.find((d) => d.productId === productId) : undefined;
    const restock = deduction ? Math.min(removed, deduction.quantity) : 0;
    console.log(`  stock:     ${restock ? `+${restock} back to the product` : "no change (not deducted for this order)"}`);

    if (!APPLY) {
        console.log("\nDry run — nothing written. Rerun with --apply.");
        return;
    }

    if (deduction) deduction.quantity -= restock;
    const res = await Order.updateOne(
        { _id: order._id, [`items.${index}.quantity`]: oldQty, total: order.total },
        {
            $set: {
                [`items.${index}.quantity`]: newQty,
                couponValue,
                shippingCost,
                total,
                ...(deduction ? { stockDeductions: deductions.filter((d) => d.quantity > 0) } : {}),
            },
        }
    );
    if (res.modifiedCount !== 1) fail("Order changed while this ran — nothing written, rerun the dry run.");
    if (restock) await Product.updateOne({ _id: item.productId }, { $inc: { stock: restock } });

    await AuditLog.create({
        actor: "script:setOrderItemQuantity",
        action: "order.quantity.change",
        targetType: "order",
        targetId: orderId,
        meta: { item: item.title, oldQty, newQty, oldTotal: order.total, newTotal: total, restock },
    });
    console.log(`\n✅ ${orderId} updated.`);
};

run()
    .catch((err) => {
        console.error("❌ setOrderItemQuantity:", err.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
