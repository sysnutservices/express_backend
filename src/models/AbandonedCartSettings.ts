// models/AbandonedCart.ts
import mongoose from "mongoose";

const AbandonedCartSchema = new mongoose.Schema({

  isEnabled: {
    type: Boolean,      // toggle ON / OFF
    default: true
  },

  timeGapMinutes: {
    type: Number,       // delay before marking abandoned
    default: 30
  },
});

export default mongoose.model("AbandonedCart", AbandonedCartSchema);
