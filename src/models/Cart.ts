import mongoose, { Schema } from "mongoose";

const CartItemSchema = new Schema(
    {
        productId: { type: String, required: true },
        title: String,
        image: String,
        slug: String,
        finalPrice: Number,
        waId: Number,
        specs: {
            processor: String,
            ram: String,
            storage: String,
            display: String,
            graphics: String,
            os: String,
        },
        quantity: { type: Number, default: 1 },
    },
    { _id: false }
);

const CartSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
        items: [CartItemSchema], // ✅ items: [{}, {}]
        notified: { type: Boolean, default: false },
        status: { type: Boolean, default: true },
    },
    { timestamps: true }
);
export default mongoose.model("Cart", CartSchema);
