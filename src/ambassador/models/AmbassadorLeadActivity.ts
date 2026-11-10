import mongoose, { Schema, Types } from "mongoose";

// Append-only timeline for a lead. Never updated or deleted.
export const LEAD_ACTIVITY_TYPES = [
  "created",
  "status_changed",
  "note",
  "follow_up_set",
  "updated",
  "reassigned",
  "ownership_extended",
  "order_matched",
  "quotation",
] as const;

export interface IAmbassadorLeadActivity {
  _id: Types.ObjectId;
  leadId: Types.ObjectId;
  actorId?: Types.ObjectId | null;
  actorType: "ambassador" | "staff" | "system";
  type: (typeof LEAD_ACTIVITY_TYPES)[number];
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const AmbassadorLeadActivitySchema = new Schema<IAmbassadorLeadActivity>(
  {
    leadId: { type: Schema.Types.ObjectId, ref: "AmbassadorLead", required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorType: { type: String, enum: ["ambassador", "staff", "system"], required: true },
    type: { type: String, enum: LEAD_ACTIVITY_TYPES, required: true },
    description: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model<IAmbassadorLeadActivity>("AmbassadorLeadActivity", AmbassadorLeadActivitySchema);
