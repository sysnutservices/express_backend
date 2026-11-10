// Sales Ambassador Network routes — mounted from routes/api.ts under /api.
// Spec: distribution/docs/04-api.md. Permission matrix: docs/05.
import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware";
import { handle, requireAmbassador, requireStaff } from "./middleware";
import * as partner from "./controllers/partnerController";
import * as admin from "./controllers/adminAmbassadorController";
import * as quotes from "./controllers/quotationController";
import * as payouts from "./controllers/payoutController";

const router = express.Router();

// Authenticated limiters key on the user, not the IP: the target audience is
// IT professionals, many of whom share one office NAT address.
const perUser = (windowMs: number, max: number, message: string) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { message }, keyGenerator: (req: any) => `u:${req.user?._id}` });
const registerLimiter = perUser(60 * 60 * 1000, 10, "Too many registration attempts, please try again later.");
const leadLimiter = perUser(60 * 60 * 1000, 60, "Too many leads added in a short time, please slow down.");
const waitlistLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { message: "Too many attempts, please try again later." } });
const quoteLimiter = perUser(60 * 60 * 1000, 120, "Too many quotations in a short time, please slow down.");
const publicQuoteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { message: "Too many requests." } });
const codeCheckLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { message: "Too many requests." } });

const active = requireAmbassador();
const independent = requireAmbassador({ type: "independent" });

// ---- Partner ----
router.get("/partners/programme", handle(partner.getProgramme));
router.get("/partners/referral/:code", codeCheckLimiter, handle(partner.checkReferralCode));
router.post("/partners/waitlist", waitlistLimiter, handle(partner.joinWaitlist));
router.post("/partners/register", protect, registerLimiter, handle(partner.register));
router.get("/partners/profile", protect, handle(partner.getProfile));
router.post("/partners/orientation/complete", protect, requireAmbassador({ statuses: ["approved"] }), handle(partner.completeOrientation));
router.get("/partners/dashboard", protect, active, handle(partner.getDashboard));
router.get("/partners/products", protect, active, handle(partner.getProducts));
router.get("/partners/referral-link", protect, active, handle(partner.getReferralLink));
router.get("/partners/leads", protect, active, handle(partner.listLeads));
router.post("/partners/leads", protect, active, leadLimiter, handle(partner.createLead));
router.get("/partners/leads/:id", protect, active, handle(partner.getLead));
router.patch("/partners/leads/:id", protect, active, handle(partner.updateLead));
router.post("/partners/leads/:id/activities", protect, active, handle(partner.addLeadNote));
router.get("/partners/commissions", protect, active, handle(partner.listCommissions));
router.get("/partners/payouts", protect, active, handle(payouts.partnerPayouts));

// ---- Phase 2: quotations (independent partners) ----
router.post("/partners/quotations/price", protect, independent, handle(quotes.previewQuotation));
router.get("/partners/quotations", protect, independent, handle(quotes.listQuotations));
router.post("/partners/quotations", protect, independent, quoteLimiter, handle(quotes.createQuotation));
router.get("/partners/quotations/:id", protect, independent, handle(quotes.getQuotation));
router.post("/partners/quotations/:id/revise", protect, independent, quoteLimiter, handle(quotes.reviseQuotation));
router.post("/partners/quotations/:id/cancel", protect, independent, handle(quotes.cancelQuotation));
router.get("/quotes/:token", publicQuoteLimiter, handle(quotes.getPublicQuote));

// ---- Admin ----
const SUPER = "super_admin" as const;
const SALES = "sales_admin" as const;
const FIN = "finance" as const;
const OPS = "operations" as const;

router.get("/admin/partners/overview", protect, requireStaff(SUPER, SALES, FIN), handle(admin.overview));
router.post("/admin/partners/reconcile", protect, requireStaff(SUPER, FIN), handle(admin.reconcile));
router.get("/admin/partners", protect, requireStaff(SUPER, SALES, FIN), handle(admin.listPartners));
router.get("/admin/partners/:id", protect, requireStaff(SUPER, SALES, FIN), handle(admin.getPartner));
router.post("/admin/partners/:id/reveal", protect, requireStaff(SUPER, FIN), handle(admin.revealSensitive));
router.patch("/admin/partners/:id/verification", protect, requireStaff(SUPER, SALES), handle(admin.changePartnerStatus("verification")));
router.patch("/admin/partners/:id/approve", protect, requireStaff(SUPER, SALES), handle(admin.changePartnerStatus("approve")));
router.patch("/admin/partners/:id/reject", protect, requireStaff(SUPER, SALES), handle(admin.changePartnerStatus("reject")));
router.patch("/admin/partners/:id/suspend", protect, requireStaff(SUPER, SALES), handle(admin.changePartnerStatus("suspend")));
router.patch("/admin/partners/:id/reactivate", protect, requireStaff(SUPER), handle(admin.changePartnerStatus("reactivate")));
router.patch("/admin/partners/:id/terminate", protect, requireStaff(SUPER), handle(admin.changePartnerStatus("terminate")));

router.get("/admin/partner-leads", protect, requireStaff(SUPER, SALES), handle(admin.listAllLeads));
router.patch("/admin/partner-leads/:id", protect, requireStaff(SUPER, SALES), handle(admin.adminUpdateLead));

router.get("/admin/laptop-minimums", protect, requireStaff(SUPER, SALES, FIN), handle(admin.laptopMinimums));
router.get("/admin/commission-rules", protect, requireStaff(SUPER, SALES, FIN), handle(admin.listRules));
router.post("/admin/commission-rules/preview", protect, requireStaff(SUPER, SALES, FIN), handle(admin.previewRule));
router.post("/admin/commission-rules", protect, requireStaff(SUPER), handle(admin.createRule));
router.patch("/admin/commission-rules/:id", protect, requireStaff(SUPER), handle(admin.updateRule));
router.post("/admin/commission-rules/:id/retire", protect, requireStaff(SUPER), handle(admin.retireRule));

// ---- Phase 3: approval, payouts, adjustments (finance) ----
router.post("/admin/commissions/run-eligibility", protect, requireStaff(SUPER, FIN), handle(payouts.runEligibilityNow));
router.post("/admin/commissions/approve", protect, requireStaff(SUPER, FIN), handle(payouts.approveCommissions));
router.get("/admin/payouts/ready", protect, requireStaff(SUPER, FIN), handle(payouts.getReadyToPay));
router.get("/admin/payouts/reconciliation", protect, requireStaff(SUPER, FIN), handle(payouts.getReconciliation));
router.get("/admin/payouts", protect, requireStaff(SUPER, FIN), handle(payouts.listPayouts));
router.post("/admin/payouts", protect, requireStaff(SUPER, FIN), handle(payouts.createPayouts));
router.get("/admin/payouts/:id", protect, requireStaff(SUPER, FIN), handle(payouts.getPayout));
router.post("/admin/payouts/:id/mark-paid", protect, requireStaff(SUPER, FIN), handle(payouts.markPaid));
router.post("/admin/payouts/:id/fail", protect, requireStaff(SUPER, FIN), handle(payouts.markFailed));
router.get("/admin/partner-adjustments", protect, requireStaff(SUPER, FIN), handle(payouts.listAdjustments));
router.post("/admin/partner-adjustments", protect, requireStaff(SUPER, FIN), handle(payouts.createAdjustment));
router.post("/admin/partner-adjustments/:id/void", protect, requireStaff(SUPER, FIN), handle(payouts.voidAdjustment));

router.get("/admin/commissions", protect, requireStaff(SUPER, SALES, FIN), handle(admin.listAllCommissions));
router.post("/admin/commissions/:id/clear-hold", protect, requireStaff(SUPER, FIN), handle(admin.clearHold));
router.post("/admin/commissions/:id/reverse", protect, requireStaff(SUPER, FIN), handle(admin.reverseCommission));

router.get("/admin/partner-waitlist", protect, requireStaff(SUPER, SALES), handle(admin.listWaitlist));
router.post("/admin/partner-waitlist/:id/invite", protect, requireStaff(SUPER, SALES), handle(admin.inviteFromWaitlist));

router.get("/admin/partner-quotations", protect, requireStaff(SUPER, SALES, FIN), handle(quotes.adminListQuotations));
router.get("/admin/discount-requests", protect, requireStaff(SUPER, SALES), handle(quotes.adminListDiscountRequests));
// Owner decision 2026-11-10 (D16): only the super admin decides special prices.
router.post("/admin/discount-requests/:id/approve", protect, requireStaff(SUPER), handle(quotes.approveDiscountRequest));
router.post("/admin/discount-requests/:id/reject", protect, requireStaff(SUPER), handle(quotes.rejectDiscountRequest));

router.post("/admin/partner-attribution", protect, requireStaff(SUPER, SALES), handle(admin.manualAttribution));

router.get("/admin/partner-settings", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.getProgrammeSettings));
router.put("/admin/partner-settings", protect, requireStaff(SUPER), handle(admin.updateProgrammeSettings));

export default router;
