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
exports.updateAbandonedCartSettings = exports.getAbandonedCartSettings = exports.notifiedCart = exports.getAllCart = exports.getCartByWaId = exports.clearCart = exports.removeCartItem = exports.updateCartItem = exports.addToCart = exports.getCart = void 0;
const Cart_1 = __importDefault(require("../models/Cart"));
const Product_1 = __importDefault(require("../models/Product"));
const User_1 = __importDefault(require("../models/User"));
const AbandonedCartSettings_1 = __importDefault(require("../models/AbandonedCartSettings"));
/* ======================
   GET CART
====================== */
const getCart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const cart = yield Cart_1.default.findOne({ userId });
    res.json(cart || { items: [] });
});
exports.getCart = getCart;
/* ======================
   ADD TO CART
====================== */
const addToCart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const { productId } = req.body;
    const mobile = yield User_1.default.findById(userId);
    const product = yield Product_1.default.findById(productId);
    if (!product) {
        return res.status(404).json({ message: "Product not found" });
    }
    const item = {
        productId: product._id.toString(),
        title: product.title,
        image: product.image,
        finalPrice: product.finalPrice,
        slug: product.slug,
        specs: product.specs || {},
        quantity: 1,
        waId: `91${mobile === null || mobile === void 0 ? void 0 : mobile.mobile}`
    };
    let cart = yield Cart_1.default.findOne({ userId });
    if (!cart) {
        cart = yield Cart_1.default.create({
            userId,
            items: [item], // ✅ items: [{}, {}]
        });
        return res.json(cart);
    }
    const existing = cart.items.find((i) => i.productId === productId);
    if (existing) {
        existing.quantity += 1;
    }
    else {
        cart.items.push(item); // ✅ push new object
    }
    cart.notified = false;
    yield cart.save();
    res.json(cart);
});
exports.addToCart = addToCart;
const updateCartItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const { productId, quantity } = req.body;
    const cart = yield Cart_1.default.findOne({ userId });
    if (!cart)
        return res.json({ items: [] });
    const item = cart.items.find((i) => i.productId === productId);
    if (item)
        item.quantity = Math.max(1, Math.min(5, quantity));
    yield cart.save();
    res.json(cart);
});
exports.updateCartItem = updateCartItem;
const removeCartItem = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const { productId } = req.params;
    yield Cart_1.default.findOneAndUpdate({ userId }, { $pull: { items: { productId } } }, { new: true });
    res.json({ message: "Item removed" });
});
exports.removeCartItem = removeCartItem;
/* ======================
   CLEAR CART
====================== */
const clearCart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    yield Cart_1.default.findOneAndUpdate({ userId }, { $set: { items: [] } });
    res.json({ message: "Cart cleared" });
});
exports.clearCart = clearCart;
const getCartByWaId = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const rawWaId = req.params.waId.replace(/\D/g, ""); // clean non-digits
    const mobile = rawWaId.startsWith("91") && rawWaId.length === 12
        ? rawWaId.slice(2)
        : rawWaId;
    const user = yield User_1.default.findOne({ mobile });
    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }
    const cart = yield Cart_1.default.findOne({ userId: user._id });
    const item = (_a = cart === null || cart === void 0 ? void 0 : cart.items) === null || _a === void 0 ? void 0 : _a[0];
    const product = item
        ? {
            title: item.title,
            slug: item.slug,
            image: item.image
        }
        : null;
    res.json({
        items: (cart === null || cart === void 0 ? void 0 : cart.items) || []
    });
});
exports.getCartByWaId = getCartByWaId;
const getAllCart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // 1️⃣ Get abandoned cart settings (single document)
    const settings = yield AbandonedCartSettings_1.default.findOne();
    // If feature is disabled → return empty safely
    if (!settings || !settings.isEnabled) {
        return res.json({
            cartId: null,
            product: null,
            items: []
        });
    }
    // 2️⃣ Find active cart (not notified yet)
    const cart = yield Cart_1.default.findOne({
        notified: false,
        status: true
    });
    if (!cart) {
        return res.json({
            cartId: null,
            product: null,
            items: []
        });
    }
    // 3️⃣ Time gap check (ABANDONED LOGIC)
    const timeGapMs = settings.timeGapMinutes * 60 * 1000;
    const isAbandoned = cart.updatedAt.getTime() + timeGapMs < Date.now();
    if (!isAbandoned) {
        return res.json({
            cartId: null,
            product: null,
            items: []
        });
    }
    // 4️⃣ Product preview (same as your code)
    const item = (_a = cart.items) === null || _a === void 0 ? void 0 : _a[0];
    const product = item
        ? {
            title: item.title,
            slug: item.slug,
            image: item.image
        }
        : null;
    res.json({
        cartId: cart._id,
        product,
        items: cart.items
    });
});
exports.getAllCart = getAllCart;
const notifiedCart = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const cartId = req.params.cartId; // MUST be string
    yield Cart_1.default.findByIdAndUpdate(cartId, { $set: { notified: true } });
    res.json({ message: "Cart notified" });
});
exports.notifiedCart = notifiedCart;
const getAbandonedCartSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    let settings = yield AbandonedCartSettings_1.default.findOne();
    // create default if not exists
    if (!settings) {
        settings = yield AbandonedCartSettings_1.default.create({});
    }
    res.json({
        isEnabled: settings.isEnabled,
        timeGapMinutes: settings.timeGapMinutes
    });
});
exports.getAbandonedCartSettings = getAbandonedCartSettings;
// controllers/abandonedCart.controller.ts
const updateAbandonedCartSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { isEnabled, timeGapMinutes } = req.body;
    let settings = yield AbandonedCartSettings_1.default.findOne();
    if (!settings) {
        settings = yield AbandonedCartSettings_1.default.create({});
    }
    if (typeof isEnabled === "boolean") {
        settings.isEnabled = isEnabled;
    }
    if (typeof timeGapMinutes === "number" && timeGapMinutes > 0) {
        settings.timeGapMinutes = timeGapMinutes;
    }
    yield settings.save();
    res.json({
        message: "Abandoned cart settings updated",
        isEnabled: settings.isEnabled,
        timeGapMinutes: settings.timeGapMinutes
    });
});
exports.updateAbandonedCartSettings = updateAbandonedCartSettings;
