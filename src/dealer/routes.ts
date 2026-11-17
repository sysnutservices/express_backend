// Dealer channel routes, mounted from routes/api.ts under /api.
// Spec: distribution/docs/13-dealer-channel.md.
import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware";
import { handle, requireStaff } from "../ambassador/middleware";
import { requireDealer } from "./middleware";
import * as dealer from "./controllers/dealerController";
import * as admin from "./controllers/adminDealerController";

const router = express.Router();

const perUser = (windowMs: number, max: number, message: string) =>
  rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { message }, keyGenerator: (req: any) => `u:${req.user?._id}` });
const registerLimiter = perUser(60 * 60 * 1000, 10, "Too many registration attempts, please try again later.");
const orderLimiter = perUser(60 * 60 * 1000, 60, "Too many orders in a short time, please slow down.");
const claimLimiter = perUser(60 * 60 * 1000, 30, "Too many claims in a short time, please slow down.");

// ---- Dealer ----
router.get("/dealers/programme", handle(dealer.getProgramme));
router.get("/dealers/profile", protect, handle(dealer.getProfile));
router.post("/dealers/register", protect, registerLimiter, handle(dealer.register));
router.get("/dealers/catalogue", protect, requireDealer, handle(dealer.getCatalogue));
router.get("/dealers/orders", protect, requireDealer, handle(dealer.listOrders));
router.post("/dealers/orders", protect, requireDealer, orderLimiter, handle(dealer.createOrder));
router.get("/dealers/orders/:id", protect, requireDealer, handle(dealer.getOrder));
router.post("/dealers/orders/:id/cancel", protect, requireDealer, handle(dealer.cancelOrder));
router.post("/dealers/orders/:id/claims", protect, requireDealer, claimLimiter, handle(dealer.createClaim));

// ---- Admin ----
const SUPER = "super_admin" as const;
const SALES = "sales_admin" as const;
const FIN = "finance" as const;
const OPS = "operations" as const;

router.get("/admin/dealers/overview", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.overview));
router.get("/admin/dealers", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.listDealers));
router.get("/admin/dealers/:id", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.getDealer));
router.post("/admin/dealers/:id/reveal", protect, requireStaff(SUPER, FIN), handle(admin.revealDealer));
router.patch("/admin/dealers/:id/approve", protect, requireStaff(SUPER, SALES), handle(admin.changeDealerStatus("approve")));
router.patch("/admin/dealers/:id/reject", protect, requireStaff(SUPER, SALES), handle(admin.changeDealerStatus("reject")));
router.patch("/admin/dealers/:id/suspend", protect, requireStaff(SUPER, SALES), handle(admin.changeDealerStatus("suspend")));
router.patch("/admin/dealers/:id/reactivate", protect, requireStaff(SUPER), handle(admin.changeDealerStatus("reactivate")));
router.patch("/admin/dealers/:id/notes", protect, requireStaff(SUPER, SALES), handle(admin.updateDealerNotes));

router.get("/admin/dealer-prices", protect, requireStaff(SUPER, SALES, FIN), handle(admin.listPrices));
router.put("/admin/dealer-prices/:productId", protect, requireStaff(SUPER), handle(admin.setPrice));

router.get("/admin/dealer-orders", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.listOrders));
router.get("/admin/dealer-orders/:id", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.getOrder));
router.post("/admin/dealer-orders/:id/payments", protect, requireStaff(SUPER, FIN), handle(admin.recordPayment));
router.post("/admin/dealer-orders/:id/serials", protect, requireStaff(SUPER, OPS), handle(admin.recordSerials));
router.post("/admin/dealer-orders/:id/dispatch", protect, requireStaff(SUPER, OPS), handle(admin.dispatchOrder));
router.post("/admin/dealer-orders/:id/delivered", protect, requireStaff(SUPER, OPS), handle(admin.markDelivered));
router.post("/admin/dealer-orders/:id/cancel", protect, requireStaff(SUPER, FIN), handle(admin.cancelOrder));
router.post("/admin/dealer-orders/:id/invoice-ref", protect, requireStaff(SUPER, FIN), handle(admin.setInvoiceRef));
router.post("/admin/dealer-orders/:id/claims/:claimId/decide", protect, requireStaff(SUPER, SALES, OPS), handle(admin.decideClaim));

router.get("/admin/dealer-serials/:serial", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.lookupSerial));

router.get("/admin/dealer-settings", protect, requireStaff(SUPER, SALES, FIN, OPS), handle(admin.getSettings));
router.put("/admin/dealer-settings", protect, requireStaff(SUPER), handle(admin.updateSettings));

export default router;
