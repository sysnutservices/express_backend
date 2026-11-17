import mongoose, { Schema, Document, Types } from "mongoose";

// Serial register for laptops sold to dealers. Lets support answer "is this
// laptop under Lapshark warranty?" for a unit a dealer resold: by default it
// is not, and a warranty bought by the dealer covers the dealer only.
export interface IDealerUnit extends Document {
  _id: Types.ObjectId;
  serial: string; // trimmed, upper-case (normalizeDealerSerial)
  productId: Types.ObjectId;
  productTitle: string;
  dealerId: Types.ObjectId;
  dealerCode: string;
  dealerOrderId: Types.ObjectId;
  orderNumber: string;
  lineId: Types.ObjectId;
  warrantyMonths: number; // 0 = sold without Lapshark warranty
  warrantyUntil?: Date; // set on delivery when warrantyMonths > 0
  soldAt: Date;
  createdAt: Date;
}

const DealerUnitSchema = new Schema<IDealerUnit>(
  {
    serial: { type: String, required: true, unique: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productTitle: { type: String, required: true },
    dealerId: { type: Schema.Types.ObjectId, ref: "DealerProfile", required: true, index: true },
    dealerCode: { type: String, required: true },
    dealerOrderId: { type: Schema.Types.ObjectId, ref: "DealerOrder", required: true, index: true },
    orderNumber: { type: String, required: true },
    lineId: { type: Schema.Types.ObjectId, required: true },
    warrantyMonths: { type: Number, required: true, default: 0 },
    warrantyUntil: Date,
    soldAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<IDealerUnit>("DealerUnit", DealerUnitSchema);
