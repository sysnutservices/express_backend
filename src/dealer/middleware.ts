import { Request, Response, NextFunction } from "express";
import DealerProfile from "./models/DealerProfile";
import { getDealerSettings } from "./services/settings";

// Use after `protect`. Loads the caller's approved DealerProfile into
// req.dealer. Runs on every request, so a suspension takes effect at once.
export const requireDealer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await getDealerSettings();
    if (!settings.enabled) return res.status(503).json({ message: "Dealer ordering is not open yet" });
    const profile = await DealerProfile.findOne({ userId: (req as any).user._id });
    if (!profile) return res.status(404).json({ message: "You are not registered as a Lapshark dealer", code: "NOT_REGISTERED" });
    if (profile.status !== "approved") {
      return res.status(403).json({ message: `Your dealer account is ${profile.status}`, code: "DEALER_NOT_APPROVED", status: profile.status });
    }
    (req as any).dealer = profile;
    next();
  } catch (err: any) {
    console.error("[dealer] requireDealer:", err.message);
    res.status(500).json({ message: "Something went wrong" });
  }
};
