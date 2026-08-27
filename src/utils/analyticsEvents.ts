// Authoritative allowlist for POST /analytics/events — this is the actual
// security boundary against arbitrary event names/collections, so this list
// is what gets checked, not client input.
//
// Mirrored (not shared/imported — separate repos, no monorepo tooling) by
// lib/analyticsEvents.ts in the frontend, which exists only for TS
// autocomplete on trackEvent() calls. If the two drift, the failure mode is
// this backend rejecting an unknown event with 400 (visible as a gap in the
// admin dashboard), not a security hole — keep them in sync, but a mismatch
// fails safe. Update both together.
export const ALLOWED_EVENTS = [
  "page_view",
  "view_item",
  "add_to_cart",
  "wishlist_add",
  "compare_started",
  "warranty_select",
  "filter_used",
  "sort_used",
  "search",
  "whatsapp_click",
  "whatsapp_expert_click",
  "whatsapp_product_click",
  "begin_checkout",
  "add_payment_info",
  "coupon_applied",
  "checkout_payment_failed",
  "login",
  "remove_from_cart",
  "view_item_list",
  "select_item",
  "laptop_recommendation_started",
  "laptop_recommendation_completed",
  "emi_info_viewed",
  "quality_report_viewed",
  "compare_product",
  // Written server-side only (orderController.ts), but still validated
  // against this same list for consistency.
  "purchase",
  "generate_lead",
] as const;

export type AllowedEventName = (typeof ALLOWED_EVENTS)[number];

export function isAllowedEvent(name: unknown): name is AllowedEventName {
  return typeof name === "string" && (ALLOWED_EVENTS as readonly string[]).includes(name);
}
