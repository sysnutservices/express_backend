import mongoose, { Schema, Document } from "mongoose";

export interface ISession extends Document {
  sessionId: string;
  visitorId: string;
  startedAt: Date;
  lastEventAt: Date;
  utm: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
  referrer?: string;
  landingPage?: string;
  userAgent?: string;
}

const SessionSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    // String, not an ObjectId ref: the client generates and sends this as
    // the same visitorId string used everywhere else — joining to Visitor
    // happens by that string, not a Mongo relation.
    visitorId: { type: String, required: true },
    startedAt: { type: Date, required: true },
    lastEventAt: { type: Date, required: true },
    utm: {
      source: { type: String },
      medium: { type: String },
      campaign: { type: String },
      term: { type: String },
      content: { type: String },
    },
    referrer: { type: String },
    landingPage: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

SessionSchema.index({ sessionId: 1 }, { unique: true });
SessionSchema.index({ visitorId: 1, startedAt: -1 });

export default mongoose.model<ISession>("Session", SessionSchema);
