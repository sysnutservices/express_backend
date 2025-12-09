import { Request, Response } from "express";
import Coupon from "../models/Coupon";

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
export const validateCoupon = async (req: Request, res: Response) => {
    try {
        const { code, cartTotal } = req.body;

        const coupon = await Coupon.findOne({ code: code.toUpperCase() });

        if (!coupon)
            return res.json({ valid: false, message: "Invalid coupon" });

        // Check active
        if (!coupon.isActive)
            return res.json({ valid: false, message: "Coupon is disabled" });

        // Check expiry
        if (coupon.expiryDate < new Date())
            return res.json({ valid: false, message: "Coupon expired" });

        // Check usage limit
        if (coupon.usedCount >= coupon.usageLimit)
            return res.json({ valid: false, message: "Coupon usage limit reached" });

        // Check minimum amount
        if (cartTotal < coupon.minOrderValue)
            return res.json({
                valid: false,
                message: `Minimum order value is ₹${coupon.minOrderValue}`,
            });

        // Calculate discount
        let discountAmount = 0;

        if (coupon.type === "percentage") {
            discountAmount = (cartTotal * coupon.value) / 100;
        } else {
            discountAmount = coupon.value;
        }

        // Cap discount (optional logic)
        if (discountAmount > cartTotal) discountAmount = cartTotal;

        const finalAmount = cartTotal - discountAmount;

        res.json({
            valid: true,
            coupon,
            discountAmount,
            finalAmount,
        });
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
