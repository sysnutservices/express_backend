import { Request, Response } from "express";
import mongoose from "mongoose";
import Review from "../models/Review";
import Order from "../models/Order";
import Product from "../models/Product";

async function recalculateProductRating(productId: string) {
  const [agg] = await Review.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(productId) } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  await Product.findByIdAndUpdate(productId, {
    rating: agg ? Math.round(agg.avg * 10) / 10 : 0,
    reviews: agg ? agg.count : 0,
  });
}

export const getProductReviews = async (req: Request, res: Response) => {
  try {
    const reviews = await Review.find({ productId: req.params.productId })
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

// Powers the homepage "Trusted by Laptop Buyers" section — real reviews only,
// picked (not written): highest-rated first, verified purchases first among
// ties, so it can never be an empty/fabricated testimonial list. Returns []
// when there simply aren't enough genuine reviews yet; the frontend renders
// a clean empty state for that rather than inventing testimonials.
export const getFeaturedReviews = async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 9, 20);
    const reviews = await Review.find({ rating: { $gte: 4 } })
      .sort({ verifiedPurchase: -1, rating: -1, createdAt: -1 })
      .limit(limit)
      .populate("productId", "title slug")
      .lean();
    res.json(
      reviews.map((r: any) => ({
        _id: r._id,
        userName: r.userName,
        rating: r.rating,
        comment: r.comment,
        verifiedPurchase: r.verifiedPurchase,
        createdAt: r.createdAt,
        productTitle: r.productId?.title,
        productSlug: r.productId?.slug,
      }))
    );
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

export const createReview = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { rating, comment } = req.body;
    const user = (req as any).user;

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ message: "Rating must be an integer from 1 to 5" });
    }
    const trimmedComment = String(comment || "").trim();
    if (!trimmedComment || trimmedComment.length > 2000) {
      return res.status(400).json({ message: "Comment is required (max 2000 chars)" });
    }

    const verifiedPurchase = await Order.exists({
      userId: user._id,
      paymentStatus: "Paid",
      "items.productId": new mongoose.Types.ObjectId(productId),
    } as any);

    const review = await Review.findOneAndUpdate(
      { productId, userId: user._id },
      {
        productId,
        userId: user._id,
        userName: user.name,
        rating: ratingNum,
        comment: trimmedComment,
        verifiedPurchase: !!verifiedPurchase,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await recalculateProductRating(productId);

    res.status(201).json(review);
  } catch (error) {
    console.error("Create review failed:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// No dedicated moderation UI yet — a direct admin-authenticated call is the
// safety valve for abusive/spam reviews until review volume justifies a page.
export const deleteReview = async (req: Request, res: Response) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.reviewId);
    if (!review) return res.status(404).json({ message: "Review not found" });
    await recalculateProductRating(String(review.productId));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};
