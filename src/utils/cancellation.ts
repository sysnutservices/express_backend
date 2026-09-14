// Pure helpers for the customer cancellation-request -> admin approve/reject
// workflow (orderController.ts's cancelOrder/rejectCancellation). Kept
// DB-free so they can be unit-tested the same way as pricing.ts/
// serialNumber.ts, with the actual Mongo read/write left to the controller.

export const CANCELLATION_REASONS = [
  "ordered_by_mistake",
  "found_better_product",
  "delivery_too_long",
  "changed_mind",
  "payment_issue",
  "wrong_product",
  "other",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export function isValidCancellationReason(raw: unknown): raw is CancellationReason {
  return typeof raw === "string" && (CANCELLATION_REASONS as readonly string[]).includes(raw);
}

// This app has no "Packed"/"Confirmed" status — Pending covers payment-
// pending, Processing covers paid/confirmed/being-prepared. Anything past
// that (Shipped, Out for Delivery, Delivered, Cancelled, RTO) is not
// customer-cancellable.
export const CUSTOMER_CANCELLABLE_STATUSES = ["Pending", "Processing"];

export function isCustomerCancellable(orderStatus: string, cancellationStatus?: string): boolean {
  return CUSTOMER_CANCELLABLE_STATUSES.includes(orderStatus) && cancellationStatus !== "Requested";
}
