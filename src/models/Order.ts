import mongoose, { Schema, Document } from "mongoose";

export interface IOrder extends Document {
  orderId: string;
  customerName: string;
  customerEmail: string;
  userId?: mongoose.Schema.Types.ObjectId;
  date: string;
  total: number;
  // COD orders charge this much upfront via Razorpay (to weed out
  // fake/careless COD orders) and leave (total - advanceAmount) to be
  // collected as cash by the courier. 0 for a fully-prepaid order.
  advanceAmount: number;
  // Client-generated at checkout, echoed by the browser's Meta Pixel
  // Purchase call and reused server-side for the Meta CAPI Purchase call in
  // markOrderPaid — the shared id is what lets Meta dedupe the two into one
  // conversion instead of double-counting it.
  metaEventId?: string;
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
    // Extra Product Offer snapshot, frozen at order-creation time — never
    // recomputed from the live product later, so an order stays accurate
    // even after the offer expires or is edited/removed. Undefined on every
    // order placed before this feature and on any item with no active offer.
    originalPrice?: number;
    extraOfferDiscount?: number;
    extraOfferLabel?: string;
  }>;
  paidAt?: Date; // ✅ ADD THIS
  shipment?: {
    awb?: string;
    courierStatus?: string;
    labelUrl?: string;
    trackingUrl?: string;
    shippedAt?: Date;
    deliveredAt?: Date;
  };
  refund?: {
    id?: string;
    amount?: number;
    status?: string; // Razorpay's 'pending' | 'processed' | 'failed'
    refundedAt?: Date;
  };
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
    advanceAmount: { type: Number, default: 0 },
    metaEventId: { type: String },
    mapLink: { type: String, default: "" },
    razorpayOrderId: { type: String, required: true },
    razorpayPaymentId: { type: String, default: "" },
    razorpaySignature: { type: String, default: "" },
    paidAt: { type: Date }, // ✅ ADD THIS

    status: {
      type: String,
      enum: ["Pending", "Processing", "Shipped", "Out for Delivery", "Delivered", "Cancelled", "RTO"],
      default: "Pending",
    },

    shipment: {
      awb: { type: String },
      courierStatus: { type: String },
      labelUrl: { type: String },
      trackingUrl: { type: String },
      shippedAt: { type: Date },
      deliveredAt: { type: Date },
    },

    refund: {
      id: { type: String },
      amount: { type: Number },
      status: { type: String },
      refundedAt: { type: Date },
    },

    paymentStatus: {
      type: String,
      enum: ["Paid", "Pending", "Failed", "Refunded"],
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
        originalPrice: { type: Number },
        extraOfferDiscount: { type: Number },
        extraOfferLabel: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IOrder>("Order", OrderSchema);