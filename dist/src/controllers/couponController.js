"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markCouponUsed = exports.validateCoupon = exports.updateCoupon = exports.deleteCoupon = exports.getCoupons = exports.createCoupon = void 0;
const Coupon_1 = __importDefault(require("../models/Coupon"));
// -------------------------------
// CREATE COUPON
// -------------------------------
const createCoupon = async (req, res) => {
    try {
        const { code, type, value, minOrderValue, expiryDate, usageLimit } = req.body;
        const exists = await Coupon_1.default.findOne({ code: code.toUpperCase() });
        if (exists)
            return res.status(400).json({ message: "Coupon already exists" });
        const coupon = await Coupon_1.default.create({
            code: code.toUpperCase(),
            type,
            value,
            minOrderValue,
            expiryDate,
            usageLimit,
        });
        res.status(201).json(coupon);
    }
    catch (err) {
        res.status(500).json({ message: "Error creating coupon", error: err });
    }
};
exports.createCoupon = createCoupon;
// -------------------------------
// GET ALL COUPONS
// -------------------------------
const getCoupons = async (_req, res) => {
    try {
        const coupons = await Coupon_1.default.find().sort({ createdAt: -1 });
        res.json(coupons);
    }
    catch (err) {
        res.status(500).json({ message: "Error fetching coupons", error: err });
    }
};
exports.getCoupons = getCoupons;
// -------------------------------
// DELETE COUPON
// -------------------------------
const deleteCoupon = async (req, res) => {
    try {
        const coupon = await Coupon_1.default.findByIdAndDelete(req.params.id);
        if (!coupon)
            return res.status(404).json({ message: "Coupon not found" });
        res.json({ message: "Coupon deleted" });
    }
    catch (err) {
        res.status(500).json({ message: "Error deleting coupon", error: err });
    }
};
exports.deleteCoupon = deleteCoupon;
// -------------------------------
// UPDATE COUPON
// -------------------------------
const updateCoupon = async (req, res) => {
    try {
        const updated = await Coupon_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated)
            return res.status(404).json({ message: "Coupon not found" });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ message: "Error updating coupon", error: err });
    }
};
exports.updateCoupon = updateCoupon;
// -------------------------------
// VALIDATE COUPON (APPLY COUPON)
// -------------------------------
const validateCoupon = async (req, res) => {
    try {
        const { code, cartTotal } = req.body;
        const coupon = await Coupon_1.default.findOne({ code: code.toUpperCase() });
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
        }
        else {
            discountAmount = coupon.value;
        }
        // Cap discount (optional logic)
        if (discountAmount > cartTotal)
            discountAmount = cartTotal;
        const finalAmount = cartTotal - discountAmount;
        res.json({
            valid: true,
            coupon,
            discountAmount,
            finalAmount,
        });
    }
    catch (err) {
        res.status(500).json({ message: "Error validating coupon", error: err });
    }
};
exports.validateCoupon = validateCoupon;
// -------------------------------
// MARK COUPON AS USED (on placing order)
// -------------------------------
const markCouponUsed = async (code) => {
    await Coupon_1.default.findOneAndUpdate({ code: code.toUpperCase() }, { $inc: { usedCount: 1 } });
};
exports.markCouponUsed = markCouponUsed;
