import mongoose, { Schema, Document } from "mongoose";

export interface IOrder extends Document {
  orderId: string;
  customerName: string;
  customerEmail: string;
  userId?: mongoose.Schema.Types.ObjectId;
  date: string;
  total: number;
  // ₹500 flat under the free-shipping threshold, ₹0 above it — same rule
  // the checkout page displays. Already folded into `total`; kept here too
  // so admin/order-detail views can show the breakdown instead of a bare
  // total that doesn't match "Subtotal + Shipping" on screen.
  shippingCost: number;
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
    // Product.specs snapshot, frozen at order-creation time like storage/
    // warranty above — undefined on every order placed before this field
    // existed. Not re-derived from the live product later: a spec sheet
    // that could silently change after purchase would be wrong on a
    // warranty document describing what was actually bought.
    specs?: { processor?: string; ram?: string; storage?: string; display?: string; graphics?: string; os?: string };
    // Extra Product Offer snapshot, frozen at order-creation time — never
    // recomputed from the live product later, so an order stays accurate
    // even after the offer expires or is edited/removed. Undefined on every
    // order placed before this feature and on any item with no active offer.
    originalPrice?: number;
    extraOfferDiscount?: number;
    extraOfferLabel?: string;
    // Not set anywhere yet — see the schema field's comment below.
    serialNumber?: string;
  }>;
  paidAt?: Date; // ✅ ADD THIS
  shipment?: {
    awb?: string;
    courierStatus?: string;
    labelUrl?: string;
    trackingUrl?: string;
    shippedAt?: Date;
    deliveredAt?: Date;
    // Set when the admin ships an order themselves instead of booking it
    // through Ekart (local delivery, courier Ekart doesn't cover, etc.) —
    // courierName/awb/trackingUrl here are then whatever the admin typed
    // in, not values Ekart's API returned.
    manual?: boolean;
    courierName?: string;
  };
  refund?: {
    id?: string;
    amount?: number;
    status?: string; // Razorpay's 'pending' | 'processed' | 'failed'
    refundedAt?: Date;
  };
  // Customer request -> admin approve/reject workflow. Absent entirely on
  // every order until a cancellation is first requested. This doubles as
  // the audit trail for the cancellation lifecycle (who/when/why) — the
  // codebase has no generic audit-log system to plug into, and this mirrors
  // the same embedded-object shape already used for refund/shipment above.
  cancellation?: {
    status: string; // 'Requested' | 'Approved' | 'Rejected'
    reason?: string; // one of CANCELLATION_REASONS (src/utils/cancellation.ts)
    note?: string; // customer's free-text note
    requestedAt?: Date;
    requestedBy?: mongoose.Schema.Types.ObjectId;
    approvedAt?: Date;
    approvedBy?: mongoose.Schema.Types.ObjectId;
    rejectedAt?: Date;
    rejectedBy?: mongoose.Schema.Types.ObjectId;
    rejectionReason?: string;
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
    shippingCost: { type: Number, default: 0 },
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
      manual: { type: Boolean },
      courierName: { type: String },
    },

    refund: {
      id: { type: String },
      amount: { type: Number },
      status: { type: String },
      refundedAt: { type: Date },
    },

    cancellation: {
      status: { type: String, enum: ["Requested", "Approved", "Rejected"] },
      reason: { type: String },
      note: { type: String },
      requestedAt: { type: Date },
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      approvedAt: { type: Date },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      rejectedAt: { type: Date },
      rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      rejectionReason: { type: String },
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
        specs: { type: Object },
        originalPrice: { type: Number },
        extraOfferDiscount: { type: Number },
        extraOfferLabel: { type: String },
        // Not set anywhere yet — no admin flow captures it. Present so the
        // warranty card can show the real serial once one exists, instead
        // of that becoming a second schema migration later.
        serialNumber: { type: String },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IOrder>("Order", OrderSchema);