import mongoose, { Schema } from "mongoose";

// One review per user per product — resubmitting edits it in place (see
// createReview's upsert), rather than allowing duplicate spam reviews.
const ReviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    userName: { type: String, required: true }, // snapshot at submit time, matches Order.customerName's denormalization
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 2000 },
    verifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ReviewSchema.index({ productId: 1, userId: 1 }, { unique: true });

export default mongoose.model("Review", ReviewSchema);
