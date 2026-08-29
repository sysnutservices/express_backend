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
exports.deleteReview = exports.createReview = exports.getFeaturedReviews = exports.getProductReviews = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Review_1 = __importDefault(require("../models/Review"));
const Order_1 = __importDefault(require("../models/Order"));
const Product_1 = __importDefault(require("../models/Product"));
function recalculateProductRating(productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const [agg] = yield Review_1.default.aggregate([
            { $match: { productId: new mongoose_1.default.Types.ObjectId(productId) } },
            { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
        ]);
        yield Product_1.default.findByIdAndUpdate(productId, {
            rating: agg ? Math.round(agg.avg * 10) / 10 : 0,
            reviews: agg ? agg.count : 0,
        });
    });
}
const getProductReviews = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const reviews = yield Review_1.default.find({ productId: req.params.productId })
            .sort({ createdAt: -1 })
            .limit(200);
        res.json(reviews);
    }
    catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
});
exports.getProductReviews = getProductReviews;
// Powers the homepage "Trusted by Laptop Buyers" section — real reviews only,
// picked (not written): highest-rated first, verified purchases first among
// ties, so it can never be an empty/fabricated testimonial list. Returns []
// when there simply aren't enough genuine reviews yet; the frontend renders
// a clean empty state for that rather than inventing testimonials.
const getFeaturedReviews = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const limit = Math.min(Number(req.query.limit) || 9, 20);
        const reviews = yield Review_1.default.find({ rating: { $gte: 4 } })
            .sort({ verifiedPurchase: -1, rating: -1, createdAt: -1 })
            .limit(limit)
            .populate("productId", "title slug")
            .lean();
        res.json(reviews.map((r) => {
            var _a, _b;
            return ({
                _id: r._id,
                userName: r.userName,
                rating: r.rating,
                comment: r.comment,
                verifiedPurchase: r.verifiedPurchase,
                createdAt: r.createdAt,
                productTitle: (_a = r.productId) === null || _a === void 0 ? void 0 : _a.title,
                productSlug: (_b = r.productId) === null || _b === void 0 ? void 0 : _b.slug,
            });
        }));
    }
    catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
});
exports.getFeaturedReviews = getFeaturedReviews;
const createReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { productId } = req.params;
        const { rating, comment } = req.body;
        const user = req.user;
        const ratingNum = Number(rating);
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
            return res.status(400).json({ message: "Rating must be an integer from 1 to 5" });
        }
        const trimmedComment = String(comment || "").trim();
        if (!trimmedComment || trimmedComment.length > 2000) {
            return res.status(400).json({ message: "Comment is required (max 2000 chars)" });
        }
        const verifiedPurchase = yield Order_1.default.exists({
            userId: user._id,
            paymentStatus: "Paid",
            "items.productId": new mongoose_1.default.Types.ObjectId(productId),
        });
        const review = yield Review_1.default.findOneAndUpdate({ productId, userId: user._id }, {
            productId,
            userId: user._id,
            userName: user.name,
            rating: ratingNum,
            comment: trimmedComment,
            verifiedPurchase: !!verifiedPurchase,
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
        yield recalculateProductRating(productId);
        res.status(201).json(review);
    }
    catch (error) {
        console.error("Create review failed:", error);
        res.status(500).json({ message: "Server Error" });
    }
});
exports.createReview = createReview;
// No dedicated moderation UI yet — a direct admin-authenticated call is the
// safety valve for abusive/spam reviews until review volume justifies a page.
const deleteReview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const review = yield Review_1.default.findByIdAndDelete(req.params.reviewId);
        if (!review)
            return res.status(404).json({ message: "Review not found" });
        yield recalculateProductRating(String(review.productId));
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
});
exports.deleteReview = deleteReview;
