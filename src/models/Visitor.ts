import mongoose, { Schema, Document } from "mongoose";

export interface IVisitor extends Document {
  visitorId: string;
  userId?: mongoose.Schema.Types.ObjectId;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstTouch: {
    source?: string;
    medium?: string;
    campaign?: string;
    referrer?: string;
    landingPage?: string;
  };
  lastTouch: {
    source?: string;
    medium?: string;
    campaign?: string;
    referrer?: string;
    landingPage?: string;
  };
  intentScore: number;
  intentLevel: "cold" | "warm" | "hot" | "customer";
  totalEvents: number;
}

const TouchSchema = {
  source: { type: String },
  medium: { type: String },
  campaign: { type: String },
  referrer: { type: String },
  landingPage: { type: String },
};

const VisitorSchema = new Schema(
  {
    visitorId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    firstTouch: TouchSchema,
    lastTouch: TouchSchema,
    intentScore: { type: Number, default: 0 },
    intentLevel: {
      type: String,
      enum: ["cold", "warm", "hot", "customer"],
      default: "cold",
    },
    totalEvents: { type: Number, default: 0 },
  },
  { timestamps: true }
);

VisitorSchema.index({ visitorId: 1 }, { unique: true });
VisitorSchema.index({ userId: 1 });
// Powers the admin "sorted by intent" visitor list — an indexed sort, not
// an in-memory one, since this collection is expected to grow unbounded.
VisitorSchema.index({ intentScore: -1 });
VisitorSchema.index({ lastSeenAt: -1 });

export default mongoose.model<IVisitor>("Visitor", VisitorSchema);
