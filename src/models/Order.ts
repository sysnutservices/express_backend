import mongoose, { Schema, Document } from "mongoose";

export interface IOrder extends Document {
  orderId: string;
  customerName: string;
  customerEmail: string;
  userId?: mongoose.Schema.Types.ObjectId;
  date: string;
  total: number;
  couponValue: number;
  coupon: string | null; // ✅ ADD THIS
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  shippingAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    type: string;
  };
  mapLink?: string;
  items: Array<{
    productId: mongoose.Schema.Types.ObjectId;
    title: string;
    quantity: number;
    finalPrice: number;
    image: string;
    storage?: any; // ✅ ADD THIS
    warranty?: any; // ✅ ADD THIS
    selectedConfig?: any; // ✅ ADD THIS
  }>;
  paidAt?: Date; // ✅ ADD THIS
}

const AddressSubSchema = new Schema(
  {
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    phone: { type: String, required: true },
    type: { type: String, required: true },
  },
  { _id: false }
);

const OrderSchema = new Schema(
  {
    orderId: { type: String, required: true },
    customerEmail: { type: String },
    customerName: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    couponValue: { type: Number, default: 0 },
    coupon: { type: String, default: null }, // ✅ ADD THIS
    date: { type: String, required: true },
    total: { type: Number, required: true },
    mapLink: { type: String, default: "" },
    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String, default: "" },
    razorpaySignature: { type: String, default: "" },
    paidAt: { type: Date }, // ✅ ADD THIS

    status: {
      type: String,
      enum: ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"],
      default: "Pending",
    },

    paymentStatus: {
      type: String,
      enum: ["Paid", "Pending", "Failed"],
      default: "Pending",
    },

    paymentMethod: { type: String, required: true },

    shippingAddress: { type: AddressSubSchema, required: true },

    items: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        title: String,
        quantity: Number,
        finalPrice: Number,
        image: String,
        storage: { type: Object }, // ✅ ADD THIS
        warranty: { type: Object }, // ✅ ADD THIS
        selectedConfig: { type: Object }, // ✅ ADD THIS
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IOrder>("Order", OrderSchema);