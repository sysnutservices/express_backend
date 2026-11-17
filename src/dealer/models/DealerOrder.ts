import mongoose, { Schema, Document, Types } from "mongoose";

// A trade order: a dealer buying laptops from Lapshark. Kept apart from the
// retail Order on purpose. It never touches coupons, Razorpay, COD or the
// ambassador commission hooks. Money is integer paise.
//
// Status flow (logic.ts canTransition):
//   placed --(payments cover total)--> paid --(serials recorded)--> packed
//   --(courier booked / handed over)--> dispatched --> delivered
//   pickup: packed --(handed over)--> delivered
//   placed | paid | packed --> cancelled (stock and serials released)
export const DEALER_ORDER_STATUSES = ["placed", "paid", "packed", "dispatched", "delivered", "cancelled"] as const;
export type DealerOrderStatus = (typeof DEALER_ORDER_STATUSES)[number];
export const DEALER_PAYMENT_METHODS = ["bank_transfer", "cash"] as const;
export type DealerPaymentMethod = (typeof DEALER_PAYMENT_METHODS)[number];
export const CLAIM_TYPES = ["transit_damage", "not_as_described", "warranty"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export const CLAIM_STATUSES = ["open", "replacement", "credit_note", "repair", "rejected"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export interface IDealerOrderLine {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  title: string;
  condition?: string;
  image?: string;
  quantity: number;
  unitPricePaise: number;
  warrantyMonths: number; // 0 = no Lapshark warranty
  warrantyPricePaise: number; // per unit, 0 when no warranty
  lineTotalPaise: number;
  serials: string[];
}

export interface IDealerPayment {
  _id: Types.ObjectId;
  method: DealerPaymentMethod;
  amountPaise: number;
  reference: string; // UTR for bank transfers, receipt number for cash
  receivedAt: Date;
  recordedBy: Types.ObjectId;
  recordedAt: Date;
  note?: string;
}

export interface IDealerClaim {
  _id: Types.ObjectId;
  type: ClaimType;
  serial: string;
  description: string;
  evidenceUrl?: string;
  status: ClaimStatus;
  resolutionNote?: string;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  createdAt: Date;
}

export interface IDealerOrder extends Document {
  _id: Types.ObjectId;
  orderNumber: string;
  dealerId: Types.ObjectId;
  dealerCode: string;
  businessName: string;
  lines: IDealerOrderLine[];
  totalPaise: number;
  paidPaise: number;
  paymentMethod: DealerPaymentMethod; // how the dealer said it will pay
  payments: IDealerPayment[];
  fulfilment: {
    method: "courier" | "pickup";
    address?: { line1: string; line2?: string; city: string; state: string; pincode: string };
    courier?: string;
    awb?: string;
    handedTo?: string;
  };
  status: DealerOrderStatus;
  statusHistory: { status: DealerOrderStatus; at: Date; by?: Types.ObjectId | null; note?: string }[];
  stockReserved: boolean;
  // Optional reference to an invoice raised outside this system, if any.
  invoiceRef?: { number?: string; note?: string; by?: Types.ObjectId; at?: Date };
  dealerNote?: string;
  cancelReason?: string;
  refundNote?: string;
  paidAt?: Date;
  packedAt?: Date;
  dispatchedAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  claims: IDealerClaim[];
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema(
  { line1: String, line2: String, city: String, state: String, pincode: String },
  { _id: false }
);

const DealerOrderSchema = new Schema<IDealerOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    dealerId: { type: Schema.Types.ObjectId, ref: "DealerProfile", required: true, index: true },
    dealerCode: { type: String, required: true },
    businessName: { type: String, required: true },
    lines: {
      type: [
        {
          productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
          title: { type: String, required: true },
          condition: String,
          image: String,
          quantity: { type: Number, required: true, min: 1 },
          unitPricePaise: { type: Number, required: true, min: 0 },
          warrantyMonths: { type: Number, required: true, default: 0 },
          warrantyPricePaise: { type: Number, required: true, default: 0 },
          lineTotalPaise: { type: Number, required: true, min: 0 },
          serials: { type: [String], default: [] },
        },
      ],
      required: true,
    },
    totalPaise: { type: Number, required: true, min: 0 },
    paidPaise: { type: Number, required: true, default: 0 },
    paymentMethod: { type: String, enum: DEALER_PAYMENT_METHODS, required: true },
    payments: {
      type: [
        {
          method: { type: String, enum: DEALER_PAYMENT_METHODS, required: true },
          amountPaise: { type: Number, required: true, min: 1 },
          reference: { type: String, required: true },
          receivedAt: { type: Date, required: true },
          recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
          recordedAt: { type: Date, required: true },
          note: String,
        },
      ],
      default: [],
    },
    fulfilment: {
      method: { type: String, enum: ["courier", "pickup"], required: true },
      address: { type: AddressSchema, default: undefined },
      courier: String,
      awb: String,
      handedTo: String,
    },
    status: { type: String, enum: DEALER_ORDER_STATUSES, required: true, default: "placed", index: true },
    statusHistory: {
      type: [
        {
          status: { type: String, enum: DEALER_ORDER_STATUSES, required: true },
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: "User", default: null },
          note: String,
          _id: false,
        },
      ],
      default: [],
    },
    stockReserved: { type: Boolean, default: false },
    invoiceRef: { type: { number: String, note: String, by: { type: Schema.Types.ObjectId, ref: "User" }, at: Date, _id: false }, default: undefined },
    dealerNote: String,
    cancelReason: String,
    refundNote: String,
    paidAt: Date,
    packedAt: Date,
    dispatchedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    claims: {
      type: [
        {
          type: { type: String, enum: CLAIM_TYPES, required: true },
          serial: { type: String, required: true },
          description: { type: String, required: true },
          evidenceUrl: String,
          status: { type: String, enum: CLAIM_STATUSES, required: true, default: "open" },
          resolutionNote: String,
          decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
          decidedAt: Date,
          createdAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

DealerOrderSchema.index({ dealerId: 1, createdAt: -1 });
DealerOrderSchema.index({ "payments.method": 1, "payments.receivedAt": 1 });
DealerOrderSchema.index({ "claims.status": 1 });

export default mongoose.model<IDealerOrder>("DealerOrder", DealerOrderSchema);
