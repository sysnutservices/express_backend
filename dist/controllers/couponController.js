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
exports.markCouponUsed = exports.validateCoupon = exports.updateCoupon = exports.deleteCoupon = exports.getCoupons = exports.createCoupon = void 0;
exports.validateAndComputeCoupon = validateAndComputeCoupon;
const Coupon_1 = __importDefault(require("../models/Coupon"));
// -------------------------------
// CREATE COUPON
// -------------------------------
const createCoupon = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, type, value, minOrderValue, expiryDate, usageLimit } = req.body;
        const exists = yield Coupon_1.default.findOne({ code: code.toUpperCase() });
        if (exists)
            return res.status(400).json({ message: "Coupon already exists" });
        const coupon = yield Coupon_1.default.create({
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
});
exports.createCoupon = createCoupon;
// -------------------------------
// GET ALL COUPONS
// -------------------------------
const getCoupons = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const coupons = yield Coupon_1.default.find().sort({ createdAt: -1 });
        res.json(coupons);
    }
    catch (err) {
        res.status(500).json({ message: "Error fetching coupons", error: err });
    }
});
exports.getCoupons = getCoupons;
// -------------------------------
// DELETE COUPON
// -------------------------------
const deleteCoupon = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const coupon = yield Coupon_1.default.findByIdAndDelete(req.params.id);
        if (!coupon)
            return res.status(404).json({ message: "Coupon not found" });
        res.json({ message: "Coupon deleted" });
    }
    catch (err) {
        res.status(500).json({ message: "Error deleting coupon", error: err });
    }
});
exports.deleteCoupon = deleteCoupon;
// -------------------------------
// UPDATE COUPON
// -------------------------------
const updateCoupon = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const updated = yield Coupon_1.default.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updated)
            return res.status(404).json({ message: "Coupon not found" });
        res.json(updated);
    }
    catch (err) {
        res.status(500).json({ message: "Error updating coupon", error: err });
    }
});
exports.updateCoupon = updateCoupon;
// Single source of truth for coupon rules (active/expiry/usage-limit/min-
// order-value/percentage-vs-fixed) — both the checkout "Apply Coupon"
// preview (validateCoupon below) and the actual order-creation path
// (orderController.createOrder) call this now. createOrder used to
// re-lookup the coupon itself and just subtract `value` flat regardless of
// type, which meant an expired/disabled/limit-exceeded/below-minimum
// coupon still worked at real checkout, and percentage coupons never
// applied a percentage.
function validateAndComputeCoupon(code, cartTotal) {
    return __awaiter(this, void 0, void 0, function* () {
        const coupon = yield Coupon_1.default.findOne({ code: code.toUpperCase() });
        if (!coupon)
            return { valid: false, message: "Invalid coupon", discountAmount: 0, finalAmount: cartTotal };
        if (!coupon.isActive)
            return { valid: false, message: "Coupon is disabled", discountAmount: 0, finalAmount: cartTotal };
        if (coupon.expiryDate < new Date())
            return { valid: false, message: "Coupon expired", discountAmount: 0, finalAmount: cartTotal };
        if (coupon.usedCount >= coupon.usageLimit)
            return { valid: false, message: "Coupon usage limit reached", discountAmount: 0, finalAmount: cartTotal };
        if (cartTotal < coupon.minOrderValue) {
            return { valid: false, message: `Minimum order value is ₹${coupon.minOrderValue}`, discountAmount: 0, finalAmount: cartTotal };
        }
        let discountAmount = coupon.type === "percentage" ? (cartTotal * coupon.value) / 100 : coupon.value;
        if (discountAmount > cartTotal)
            discountAmount = cartTotal;
        return { valid: true, coupon, discountAmount, finalAmount: cartTotal - discountAmount };
    });
}
const validateCoupon = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { code, cartTotal } = req.body;
        const result = yield validateAndComputeCoupon(code, cartTotal);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ message: "Error validating coupon", error: err });
    }
});
exports.validateCoupon = validateCoupon;
// -------------------------------
// MARK COUPON AS USED (on placing order)
// -------------------------------
const markCouponUsed = (code) => __awaiter(void 0, void 0, void 0, function* () {
    yield Coupon_1.default.findOneAndUpdate({ code: code.toUpperCase() }, { $inc: { usedCount: 1 } });
});
exports.markCouponUsed = markCouponUsed;
