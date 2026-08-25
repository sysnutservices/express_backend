import BehaviorEvent from "../models/BehaviorEvent";

// Configurable weight per event — deliberately a plain map, not hardcoded
// inside the calculation, so tuning the model later is a one-line edit here
// rather than a code change to the scoring logic itself.
export const EVENT_WEIGHTS: Record<string, number> = {
  page_view: 0,
  view_item: 1,
  warranty_select: 2,
  filter_used: 1,
  sort_used: 0,
  wishlist_add: 3,
  compare_started: 2,
  whatsapp_click: 7,
  add_to_cart: 10,
  coupon_applied: 3,
  begin_checkout: 20,
  checkout_payment_failed: 5,
  login: 2,
  generate_lead: 15,
  purchase: 100,
};

export function scoreToLevel(score: number): "cold" | "warm" | "hot" | "customer" {
  if (score >= 100) return "customer";
  if (score >= 21) return "hot";
  if (score >= 6) return "warm";
  return "cold";
}

// Recomputes from the visitor's full event history rather than incrementing
// a running counter — simpler and self-correcting (a bad write never
// compounds), and this collection's per-visitor event count is small enough
// that re-summing on every ingest is cheap. Revisit if that stops being true.
export async function calculateIntentScore(visitorId: string): Promise<number> {
  const events = await BehaviorEvent.find({ visitorId }).select("eventName").lean();
  return events.reduce((total, e) => total + (EVENT_WEIGHTS[e.eventName] ?? 0), 0);
}
