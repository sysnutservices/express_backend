import mongoose, { Schema } from "mongoose";

const CartItemSchema = new Schema(
    {
        productId: { type: String, required: true },
        // One cart line per product+config, so "16GB/512GB" and "8GB/256GB"
        // of the same laptop never collapse into a single row. Equals
        // productId for an unconfigured item, which is also what legacy rows
        // (saved before this field existed) fall back to — see cartLineId.
        lineId: String,
        // Selected config values, re-validated server-side against the
        // product's configOptions (createOrder prices from these).
        config: {
            ram: String,
            storage: String,
            warranty: String,
        },
        // The matching {label, value, price} option objects — the cart and
        // checkout pages read configOptions.*.price for the live price.
        configOptions: { type: Schema.Types.Mixed },
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
