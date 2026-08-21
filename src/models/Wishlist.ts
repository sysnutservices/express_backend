import mongoose, { Schema } from "mongoose";

const WishlistItemSchema = new Schema(
    {
        productId: { type: String, required: true },
        title: String,
        image: String,
        finalPrice: Number,
        price: Number,
        specs: {
            processor: String,
            ram: String,
            storage: String,
        },
        addedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const WishlistSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        items: [WishlistItemSchema],
    },
    { timestamps: true }
);

export default mongoose.model("Wishlist", WishlistSchema);
