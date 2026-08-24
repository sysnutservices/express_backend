import { Request, Response } from "express";
import Coupon, { ICoupon } from "../models/Coupon";

// -------------------------------
// CREATE COUPON
// -------------------------------
export const createCoupon = async (req: Request, res: Response) => {
    try {
        const { code, type, value, minOrderValue, expiryDate, usageLimit } = req.body;

        const exists = await Coupon.findOne({ code: code.toUpperCase() });
        if (exists) return res.status(400).json({ message: "Coupon already exists" });

        const coupon = await Coupon.create({
            code: code.toUpperCase(),
            type,
            value,
            minOrderValue,
            expiryDate,
            usageLimit,
        });

        res.status(201).json(coupon);
    } catch (err) {
        res.status(500).json({ message: "Error creating coupon", error: err });
    }
};

// -------------------------------
// GET ALL COUPONS
// -------------------------------
export const getCoupons = async (_req: Request, res: Response) => {
    try {
        const coupons = await Coupon.find().sort({ createdAt: -1 });
        res.json(coupons);
    } catch (err) {
        res.status(500).json({ message: "Error fetching coupons", error: err });
    }
};

// -------------------------------
// DELETE COUPON
// -------------------------------
export const deleteCoupon = async (req: Request, res: Response) => {
    try {
        const coupon = await Coupon.findByIdAndDelete(req.params.id);

        if (!coupon)
            return res.status(404).json({ message: "Coupon not found" });

        res.json({ message: "Coupon deleted" });
    } catch (err) {
        res.status(500).json({ message: "Error deleting coupon", error: err });
    }
};

// -------------------------------
// UPDATE COUPON
// -------------------------------
export const updateCoupon = async (req: Request, res: Response) => {
    try {
        const updated = await Coupon.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );

        if (!updated)
            return res.status(404).json({ message: "Coupon not found" });

        res.json(updated);
    } catch (err) {
        res.status(500).json({ message: "Error updating coupon", error: err });
    }
};

// -------------------------------
// VALIDATE COUPON (APPLY COUPON)
// -------------------------------
export interface CouponValidationResult {
    valid: boolean;
    message?: string;
    coupon?: ICoupon;
    discountAmount: number;
    finalAmount: number;
}

// Single source of truth for coupon rules (active/expiry/usage-limit/min-
// order-value/percentage-vs-fixed) — both the checkout "Apply Coupon"
// preview (validateCoupon below) and the actual order-creation path
// (orderController.createOrder) call this now. createOrder used to
// re-lookup the coupon itself and just subtract `value` flat regardless of
// type, which meant an expired/disabled/limit-exceeded/below-minimum
// coupon still worked at real checkout, and percentage coupons never
// applied a percentage.
export async function validateAndComputeCoupon(code: string, cartTotal: number): Promise<CouponValidationResult> {
    const coupon = await Coupon.findOne({ code: code.toUpperCase() });

    if (!coupon) return { valid: false, message: "Invalid coupon", discountAmount: 0, finalAmount: cartTotal };
    if (!coupon.isActive) return { valid: false, message: "Coupon is disabled", discountAmount: 0, finalAmount: cartTotal };
    if (coupon.expiryDate < new Date()) return { valid: false, message: "Coupon expired", discountAmount: 0, finalAmount: cartTotal };
    if (coupon.usedCount >= coupon.usageLimit) return { valid: false, message: "Coupon usage limit reached", discountAmount: 0, finalAmount: cartTotal };
    if (cartTotal < coupon.minOrderValue) {
        return { valid: false, message: `Minimum order value is ₹${coupon.minOrderValue}`, discountAmount: 0, finalAmount: cartTotal };
    }

    let discountAmount = coupon.type === "percentage" ? (cartTotal * coupon.value) / 100 : coupon.value;
    if (discountAmount > cartTotal) discountAmount = cartTotal;

    return { valid: true, coupon, discountAmount, finalAmount: cartTotal - discountAmount };
}

export const validateCoupon = async (req: Request, res: Response) => {
    try {
        const { code, cartTotal } = req.body;
        const result = await validateAndComputeCoupon(code, cartTotal);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: "Error validating coupon", error: err });
    }
};

// -------------------------------
// MARK COUPON AS USED (on placing order)
// -------------------------------
export const markCouponUsed = async (code: string) => {
    await Coupon.findOneAndUpdate(
        { code: code.toUpperCase() },
        { $inc: { usedCount: 1 } }
    );
};
