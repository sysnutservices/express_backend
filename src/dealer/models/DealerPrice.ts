import mongoose, { Schema, Document, Types } from "mongoose";

// Private trade price for one laptop listing, in integer paise. Returned only
// to signed-in approved dealers and to staff. Never by a public, retail,
// ambassador or quote API. One live document per product; every change is
// appended to `history` (and written to the AuditLog).
export interface IDealerWarranty {
  months: number;
  pricePaise: number;
}

export interface IDealerPrice extends Document {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  pricePaise: number;
  // Optional Lapshark warranty a dealer can add per unit. Honoured to the
  // DEALER only (owner decision 2026-11-17), never to the dealer's customer.
  warranty?: IDealerWarranty | null;
  active: boolean;
  history: { pricePaise: number; warranty?: IDealerWarranty | null; active: boolean; at: Date; by?: Types.ObjectId }[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WarrantySchema = new Schema<IDealerWarranty>(
  { months: { type: Number, required: true }, pricePaise: { type: Number, required: true } },
  { _id: false }
);

const DealerPriceSchema = new Schema<IDealerPrice>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, unique: true },
    pricePaise: { type: Number, required: true, min: 1 },
    warranty: { type: WarrantySchema, default: null },
    active: { type: Boolean, default: true, index: true },
    history: {
      type: [
        {
          pricePaise: Number,
          warranty: { type: WarrantySchema, default: null },
          active: Boolean,
          at: Date,
          by: { type: Schema.Types.ObjectId, ref: "User" },
          _id: false,
        },
      ],
      default: [],
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model<IDealerPrice>("DealerPrice", DealerPriceSchema);
