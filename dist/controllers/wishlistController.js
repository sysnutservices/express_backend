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
exports.removeFromWishlist = exports.addToWishlist = exports.getWishlist = void 0;
const Wishlist_1 = __importDefault(require("../models/Wishlist"));
const Product_1 = __importDefault(require("../models/Product"));
const getWishlist = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const wishlist = yield Wishlist_1.default.findOne({ userId });
    res.json(wishlist || { items: [] });
});
exports.getWishlist = getWishlist;
const addToWishlist = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const { productId } = req.body;
    const product = yield Product_1.default.findById(productId);
    if (!product) {
        return res.status(404).json({ message: "Product not found" });
    }
    const item = {
        productId: product._id.toString(),
        title: product.title,
        image: product.image,
        price: product.price,
        finalPrice: product.finalPrice,
        specs: product.specs || {},
        addedAt: new Date()
    };
    let wishlist = yield Wishlist_1.default.findOne({ userId });
    if (!wishlist) {
        wishlist = yield Wishlist_1.default.create({
            userId,
            items: [item]
        });
        return res.json({ success: true, items: wishlist.items });
    }
    const exists = wishlist.items.some((i) => i.productId === productId);
    if (!exists) {
        wishlist.items.push(item);
        yield wishlist.save();
    }
    res.json({ success: true, items: wishlist.items });
});
exports.addToWishlist = addToWishlist;
const removeFromWishlist = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const userId = req.user.id;
    const { productId } = req.params;
    yield Wishlist_1.default.findOneAndUpdate({ userId }, { $pull: { items: { productId } } }, { new: true });
    res.json({ message: "Removed from wishlist" });
});
exports.removeFromWishlist = removeFromWishlist;
