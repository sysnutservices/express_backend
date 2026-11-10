import { Request, Response, NextFunction } from "express";
import AmbassadorProfile, { PartnerStatus } from "./models/AmbassadorProfile";
import { getSettings } from "./services/settings";

export type StaffRole = "super_admin" | "sales_admin" | "operations" | "finance";

export function staffRoleOf(user: any): StaffRole | null {
  if (!user || user.role !== "admin") return null;
  return (user.staffRole as StaffRole) || "super_admin"; // pre-existing admins keep full access
}

// Use after `protect`. 403 (not 401) for a logged-in non-staff user so the
// frontend's 401 interceptor doesn't log them out.
export const requireStaff =
  (...roles: StaffRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    const role = staffRoleOf((req as any).user);
    if (!role) return res.status(403).json({ message: "Not authorized" });
    if (roles.length && !roles.includes(role)) return res.status(403).json({ message: "Your staff role cannot perform this action" });
    (req as any).staffRole = role;
    next();
  };

// Use after `protect`. Loads the caller's AmbassadorProfile into
// req.ambassador. Runs on every request, so suspension takes effect at once.
export const requireAmbassador =
  (opts: { statuses?: PartnerStatus[]; type?: "referral" | "independent" } = {}) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await getSettings();
      if (!settings.programmeEnabled) return res.status(503).json({ message: "The partner programme is not open yet" });
      const profile = await AmbassadorProfile.findOne({ userId: (req as any).user._id });
      if (!profile) return res.status(404).json({ message: "You are not registered as a Lapshark partner", code: "NOT_REGISTERED" });
      const statuses = opts.statuses || ["active"];
      if (!statuses.includes(profile.status)) {
        return res.status(403).json({ message: `Your partner account is ${profile.status.replace(/_/g, " ")}`, code: "PARTNER_NOT_ACTIVE", status: profile.status });
      }
      if (opts.type && profile.partnerType !== opts.type) {
        return res.status(403).json({ message: "This feature is for Independent Sales Ambassadors" });
      }
      (req as any).ambassador = profile;
      next();
    } catch (err: any) {
      console.error("[ambassador] requireAmbassador:", err.message);
      res.status(500).json({ message: "Something went wrong" });
    }
  };

export const requireProgrammeEnabled = async (_req: Request, res: Response, next: NextFunction) => {
  const settings = await getSettings();
  if (!settings.programmeEnabled) return res.status(503).json({ message: "The partner programme is not open yet" });
  next();
};

// Wraps async handlers so a thrown error becomes a 500 (or err.status) JSON
// response instead of an unhandled rejection. Express 5 forwards rejected
// promises itself, but the codebase has no JSON error handler mounted.
export const handle =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      if (err?.status && err.status < 500) return res.status(err.status).json({ message: err.message });
      console.error(`[ambassador] ${req.method} ${req.path}:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ message: "Something went wrong. Please try again." });
    }
  };
