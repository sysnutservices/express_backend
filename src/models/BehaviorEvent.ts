import mongoose, { Schema, Document } from "mongoose";

export interface IBehaviorEvent extends Document {
  eventName: string;
  // Nullable: server-side events (purchase, generate_lead) are written from
  // orderController.ts with no client session available at all.
  visitorId?: string | null;
  sessionId?: string | null;
  userId?: mongoose.Schema.Types.ObjectId;
  properties: Record<string, unknown>;
  page?: {
    url?: string;
    path?: string;
    title?: string;
  };
  source: "client" | "server";
}

const BehaviorEventSchema = new Schema(
  {
    eventName: { type: String, required: true },
    visitorId: { type: String, default: null },
    sessionId: { type: String, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Loosely-typed whitelisted bag, same convention as Order.ts's
    // storage/warranty/selectedConfig fields (Object, not Schema.Types.Mixed).
    properties: { type: Object, default: {} },
    page: {
      url: { type: String },
      path: { type: String },
      title: { type: String },
    },
    source: { type: String, enum: ["client", "server"], required: true },
  },
  { timestamps: true }
);

// Journey timeline query (one visitor's full chronological history).
BehaviorEventSchema.index({ visitorId: 1, createdAt: -1 });
// Funnel aggregation query (counts per event name over a date range).
BehaviorEventSchema.index({ eventName: 1, createdAt: -1 });
BehaviorEventSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IBehaviorEvent>("BehaviorEvent", BehaviorEventSchema);
