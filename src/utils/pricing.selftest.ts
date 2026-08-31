// Runnable self-check for the Extra Product Offer pricing engine — no
// network/DB call, matching the codebase's no-framework selftest convention.
// Run: npx ts-node src/utils/pricing.selftest.ts (or `npm test`)
import assert from "assert";
import { calculateProductPrice, getExtraOfferStatus, isExtraOfferActive, validateExtraOfferInput } from "./pricing";
import { IExtraOffer } from "../models/Product";

function offer(overrides: Partial<IExtraOffer> = {}): IExtraOffer {
  return {
    discountType: "fixed",
    discountValue: 1500,
    isActive: true,
    showOnProduct: true,
    showOnListing: true,
    showOnHomepage: true,
    ...overrides,
  };
}

function main() {
  // 1. No offer at all.
  assert.deepStrictEqual(calculateProductPrice(24999, undefined), { sellingPrice: 24999, finalPrice: 24999, offer: null });

  // 2. Fixed ₹1,500 off.
  let r = calculateProductPrice(24999, offer());
  assert.strictEqual(r.finalPrice, 23499);
  assert.strictEqual(r.offer?.discountAmount, 1500);

  // 3. Percentage 5% off, with currency rounding.
  r = calculateProductPrice(24999, offer({ discountType: "percentage", discountValue: 5 }));
  assert.strictEqual(r.finalPrice, 24999 - Math.round(24999 * 0.05));
  assert.strictEqual(r.offer?.discountAmount, Math.round(24999 * 0.05));

  // 4. Special final price.
  r = calculateProductPrice(24999, offer({ discountType: "specialPrice", discountValue: 22999 }));
  assert.strictEqual(r.finalPrice, 22999);
  assert.strictEqual(r.offer?.discountAmount, 2000);

  // 5. Scheduled — starts in the future, must not affect price yet.
  const future = new Date(Date.now() + 86400000).toISOString();
  r = calculateProductPrice(24999, offer({ startAt: future as any }));
  assert.strictEqual(r.finalPrice, 24999);
  assert.strictEqual(r.offer, null);
  assert.strictEqual(getExtraOfferStatus(offer({ startAt: future as any })), "scheduled");

  // 6. Expired — endAt in the past.
  const past = new Date(Date.now() - 86400000).toISOString();
  r = calculateProductPrice(24999, offer({ endAt: past as any }));
  assert.strictEqual(r.finalPrice, 24999);
  assert.strictEqual(getExtraOfferStatus(offer({ endAt: past as any })), "expired");

  // 7. Manually disabled.
  r = calculateProductPrice(24999, offer({ isActive: false }));
  assert.strictEqual(r.finalPrice, 24999);
  assert.strictEqual(getExtraOfferStatus(offer({ isActive: false })), "disabled");

  // 8. Discount equals product price — final price is exactly ₹0, not negative.
  r = calculateProductPrice(1500, offer({ discountValue: 1500 }));
  assert.strictEqual(r.finalPrice, 0);
  assert.strictEqual(r.offer?.discountAmount, 1500);

  // 9. Discount exceeds product price — clamps to ₹0, never negative.
  r = calculateProductPrice(1000, offer({ discountValue: 1500 }));
  assert.strictEqual(r.finalPrice, 0);
  assert.strictEqual(r.offer?.discountAmount, 1000);

  // 10. specialPrice above current selling price — clamps to a no-op (never
  //     raises the price), and reports no active offer.
  r = calculateProductPrice(20000, offer({ discountType: "specialPrice", discountValue: 25000 }));
  assert.strictEqual(r.finalPrice, 20000);
  assert.strictEqual(r.offer, null);

  // 11. Empty startAt/endAt: immediately active, never expires.
  assert.strictEqual(isExtraOfferActive(offer({ startAt: null, endAt: null })), true);

  // 12. No offer object -> status "none", not "disabled".
  assert.strictEqual(getExtraOfferStatus(null), "none");
  assert.strictEqual(getExtraOfferStatus(undefined), "none");

  // --- validateExtraOfferInput ---

  assert.deepStrictEqual(validateExtraOfferInput({ discountType: "fixed", discountValue: 1500 }, 24999), { valid: true });
  assert.strictEqual(validateExtraOfferInput({ discountType: "bogus" as any, discountValue: 10 }, 24999).valid, false);
  assert.strictEqual(validateExtraOfferInput({ discountType: "fixed", discountValue: -10 }, 24999).valid, false);
  assert.strictEqual(validateExtraOfferInput({ discountType: "percentage", discountValue: 150 }, 24999).valid, false);
  assert.strictEqual(validateExtraOfferInput({ discountType: "fixed", discountValue: 30000 }, 24999).valid, false, "fixed discount exceeding selling price must be rejected");
  assert.strictEqual(validateExtraOfferInput({ discountType: "specialPrice", discountValue: 30000 }, 24999).valid, false, "special price above selling price must be rejected");
  assert.strictEqual(
    validateExtraOfferInput({ discountType: "fixed", discountValue: 100, startAt: "2026-09-10", endAt: "2026-09-01" }, 24999).valid,
    false,
    "end date before start date must be rejected"
  );
  assert.deepStrictEqual(
    validateExtraOfferInput({ discountType: "fixed", discountValue: 100, startAt: null, endAt: null }, 24999),
    { valid: true },
    "empty start/end dates are valid (immediately active, no expiry)"
  );

  console.log("pricing.selftest: all assertions passed");
}

main();
