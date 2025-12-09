"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const AddressSubSchema = new mongoose_1.Schema({
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    zip: { type: String, required: true },
    phone: { type: String, required: true },
    type: { type: String, required: true },
}, { _id: false });
const OrderSchema = new mongoose_1.Schema({
    orderId: { type: String, required: true },
    customerEmail: { type: String },
    customerName: { type: String, required: true },
    userId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
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
            productId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "Product" },
            title: String,
            quantity: Number,
            finalPrice: Number,
            image: String,
            storage: { type: Object }, // ✅ ADD THIS
            warranty: { type: Object }, // ✅ ADD THIS
            selectedConfig: { type: Object }, // ✅ ADD THIS
        },
    ],
}, { timestamps: true });
exports.default = mongoose_1.default.model("Order", OrderSchema);
