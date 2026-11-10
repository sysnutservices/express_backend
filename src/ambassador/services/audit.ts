import AuditLog from "../../models/AuditLog";

// Reuses the existing AuditLog collection (no duplicate audit system).
// Awaited (unlike logAdminAction) so tests and callers can rely on the entry
// existing, but a failed write is still only logged — it never blocks the
// privileged action itself. Never pass PAN/payout plaintext in meta.
export async function audit(entry: {
  actor: { _id?: unknown; name?: string; email?: string } | null | undefined;
  action: string; // always "ambassador.*"
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}) {
  try {
    await AuditLog.create({
      actorId: entry.actor?._id ? String(entry.actor._id) : undefined,
      actor: entry.actor?.name || entry.actor?.email || (entry.actor?._id ? String(entry.actor._id) : "system"),
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      meta: { ...(entry.meta || {}), before: entry.before, after: entry.after },
    });
  } catch (err: any) {
    console.error("[ambassador] audit log write failed:", err.message);
  }
}
