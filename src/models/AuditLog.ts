import mongoose, { Schema } from "mongoose";

// Minimal admin-action audit trail — not a generic event-sourcing system,
// just enough to answer "who did what, when" for the handful of sensitive
// admin actions that call logAdminAction below.
const AuditLogSchema = new Schema(
  {
    actorId: { type: String }, // absent for a failed login (no user resolved)
    actor: { type: String, required: true }, // name/email, for a readable list without a join
    action: { type: String, required: true },
    targetType: { type: String },
    targetId: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

const AuditLog = mongoose.model("AuditLog", AuditLogSchema);
export default AuditLog;

// Fire-and-forget: a logging failure must never block the real admin
// action it's recording.
export const logAdminAction = (entry: {
  actorId?: string | null;
  actor: string;
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: any;
}) => {
  AuditLog.create(entry).catch((err) => console.error("audit log write failed:", err.message));
};
