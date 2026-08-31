import { IExtraOffer } from "../models/Product";

// Single source of truth for "Extra Product Offer" pricing — every place
// that needs a product's actual customer-facing price (product listing/
// detail responses aside, since those just return the stored fields and let
// each renderer call this) calls calculateProductPrice() rather than
// re-deriving the math. Mirrored on the frontend at Lapshark/lib/pricing.ts
// (kept in sync by hand — the two apps are separate repos/runtimes, so a
// literal shared module isn't possible; the frontend copy is for *display*
// only, this one is what actually gets charged).
//
// Pricing hierarchy: product.price (MRP) -> product.finalPrice (existing
// sale price, already discounted by discountPercent) -> extraOffer (this
// module) -> coupon (applied at cart-total level in couponController,
// unchanged). Config addon costs (RAM/storage/warranty upgrades) are NOT
// part of this — they're added by the caller on top of the returned
// finalPrice, exactly like the pre-existing `product.finalPrice + configCost`
// pattern in productController/orderController.
//
// Margin protection (spec: minimumMarginPercent): Product has no cost/
// landedCost field anywhere in this schema today. Rather than invent one,
// this module has nowhere to enforce a margin floor — minimumMarginPercent
// is stored on the offer for forward-compatibility (see Product.ts) but
// intentionally unused here. Wiring it in later is one guard clause once a
// real cost field exists: `if (product.costPrice) { ... }`.

export interface ExtraOfferSnapshot {
  discountType: IExtraOffer["discountType"];
  discountValue: number;
  offerLabel?: string;
  discountAmount: number; // always a positive ₹ amount, whatever discountType was
  offerId?: string; // not a separate collection, so this is the product's own id
}

export interface ProductPriceResult {
  sellingPrice: number; // product.finalPrice — the pre-offer price the offer applies to
  finalPrice: number; // sellingPrice - offer discount (or sellingPrice if none active)
  offer: ExtraOfferSnapshot | null;
}

export type ExtraOfferStatus = "none" | "scheduled" | "active" | "expired" | "disabled";

// The four states from the spec, collapsed with "none" for products that
// never had an offer at all — kept separate from isExtraOfferActive() below
// because the admin list/edit UI needs to *label* a disabled/expired offer,
// not just know whether it currently affects price.
export function getExtraOfferStatus(offer: IExtraOffer | null | undefined, now: Date = new Date()): ExtraOfferStatus {
  if (!offer) return "none";
  if (!offer.isActive) return "disabled";
  if (offer.startAt && now < new Date(offer.startAt)) return "scheduled";
  if (offer.endAt && now > new Date(offer.endAt)) return "expired";
  return "active";
}

export function isExtraOfferActive(offer: IExtraOffer | null | undefined, now: Date = new Date()): boolean {
  return getExtraOfferStatus(offer, now) === "active";
}

// Rounded to the nearest rupee at every step — this codebase has no paise/
// integer-money abstraction anywhere (every existing price field is a plain
// rupee Number), so introducing one here would be inconsistent with every
// other price on the site rather than safer. Rounding immediately after each
// discount computation (not just once at the end) is what actually avoids
// float drift compounding across percentage math.
function round(n: number): number {
  return Math.round(n);
}

// sellingPrice is product.finalPrice (or product.finalPrice + configCost,
// caller's choice — see the module comment) BEFORE the extra offer.
export function calculateProductPrice(
  sellingPrice: number,
  offer: IExtraOffer | null | undefined,
  productIdForOfferId?: string,
  now: Date = new Date()
): ProductPriceResult {
  const base = Math.max(0, round(sellingPrice));

  if (!isExtraOfferActive(offer, now) || !offer) {
    return { sellingPrice: base, finalPrice: base, offer: null };
  }

  let finalPrice: number;
  if (offer.discountType === "specialPrice") {
    finalPrice = round(offer.discountValue);
  } else if (offer.discountType === "percentage") {
    finalPrice = round(base - (base * offer.discountValue) / 100);
  } else {
    finalPrice = round(base - offer.discountValue);
  }

  // Section 6: never below ₹0, never above the price it's discounting from
  // (a "discount" that raises the price, or a special price typo'd higher
  // than the current selling price, both clamp to a no-op instead of
  // charging more or going negative).
  finalPrice = Math.min(base, Math.max(0, finalPrice));

  const discountAmount = base - finalPrice;
  // A clamped/zero-value offer (e.g. specialPrice typo'd >= sellingPrice)
  // still displays as "no active discount" rather than a 0-off badge.
  if (discountAmount <= 0) {
    return { sellingPrice: base, finalPrice: base, offer: null };
  }

  return {
    sellingPrice: base,
    finalPrice,
    offer: {
      discountType: offer.discountType,
      discountValue: offer.discountValue,
      offerLabel: offer.offerLabel,
      discountAmount,
      offerId: productIdForOfferId,
    },
  };
}

export interface ExtraOfferValidationInput {
  discountType?: string;
  discountValue?: number;
  offerLabel?: string;
  startAt?: string | null;
  endAt?: string | null;
  isActive?: boolean;
}

// Server-side validation for the create/update-offer endpoint (spec #19).
// Never trusts the browser: re-checked here regardless of what the admin
// form already validated client-side.
export function validateExtraOfferInput(
  input: ExtraOfferValidationInput,
  currentSellingPrice: number
): { valid: true } | { valid: false; message: string } {
  const { discountType, discountValue, startAt, endAt } = input;

  if (discountType !== "fixed" && discountType !== "percentage" && discountType !== "specialPrice") {
    return { valid: false, message: "Invalid discount type." };
  }
  if (typeof discountValue !== "number" || !Number.isFinite(discountValue) || discountValue < 0) {
    return { valid: false, message: "Discount value must be a positive number." };
  }
  if (discountType === "percentage" && discountValue > 100) {
    return { valid: false, message: "Percentage discount cannot exceed 100%." };
  }
  if (discountType === "fixed" && discountValue > currentSellingPrice) {
    return { valid: false, message: `Discount amount cannot exceed the current selling price (₹${currentSellingPrice}).` };
  }
  if (discountType === "specialPrice" && discountValue > currentSellingPrice) {
    return { valid: false, message: `Special price cannot be higher than the current selling price (₹${currentSellingPrice}).` };
  }
  if (discountType === "specialPrice" && discountValue < 0) {
    return { valid: false, message: "Special price cannot be negative." };
  }

  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (start && Number.isNaN(start.getTime())) return { valid: false, message: "Invalid start date." };
  if (end && Number.isNaN(end.getTime())) return { valid: false, message: "Invalid end date." };
  if (start && end && end <= start) {
    return { valid: false, message: "End date must be after start date." };
  }

  return { valid: true };
}
