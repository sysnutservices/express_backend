// Which abandoned orders get an automatic "complete your payment" WhatsApp.
// Pure (no DB/network) so the selection rules can be checked by
// paymentReminder.selftest.ts; orderController.startPaymentReminders feeds it.

// Same 1h the admin orders page waits before calling an order Abandoned
// (Lapshark lib/orderPayment.ts) — before that the customer may still be in
// the Razorpay window or a UPI app.
export const REMIND_AFTER_MS = 60 * 60 * 1000;
// Older than this, a reminder is more likely to annoy than to sell.
export const REMIND_WITHIN_MS = 24 * 60 * 60 * 1000;

export interface ReminderCandidate {
  orderId: string;
  customerKey: string;
  createdAt: Date;
  reminded: boolean;
}

// One customer, one key: the account if the order has one, otherwise the
// last 10 digits of the address phone (stored formats vary: +91, spaces).
export function customerKeyOf(order: { userId?: unknown; shippingAddress?: { phone?: string } }): string {
  const user = order.userId as any;
  const id = user?._id ?? user;
  if (id) return `user:${String(id)}`;
  const digits = (order.shippingAddress?.phone || "").replace(/\D/g, "").slice(-10);
  return digits ? `phone:${digits}` : "";
}

// What the customer still has to pay through Razorpay: the ₹500 advance on
// a COD order, the full total otherwise (same split createOrder charges).
export function amountDue(order: { paymentMethod?: string; advanceAmount?: number; total: number }): number {
  return order.paymentMethod === "COD" && order.advanceAmount ? order.advanceAmount : order.total;
}

// The name after "Hi" in the reminder. Customers sometimes type their
// address into the name field at checkout ("Ravi Kumar , MG Road ,
// Indiranagar"), so a name with a comma or digit, or longer than 4 words, is
// skipped for the next one, and "there" if none looks like a name.
export function greetingName(...names: (string | undefined | null)[]): string {
  for (const raw of names) {
    const name = (raw || "").replace(/\s+/g, " ").trim();
    if (name && !/[,\d]/.test(name) && name.split(" ").length <= 4) return name;
  }
  return "there";
}

// `pending`: every Pending/Pending order from the last REMIND_WITHIN_MS,
// including ones too fresh to remind and ones already reminded. `paid`: the
// same customers' paid orders. Returns the orderIds to remind now.
//
// Each Pay click creates a new order, so one customer often leaves several.
// Only their latest one counts: if it is still fresh they are probably still
// checking out, if it was already reminded they've heard from us, and if
// they paid for anything after it they already bought.
export function pickOrdersToRemind(
  pending: ReminderCandidate[],
  paid: { customerKey: string; createdAt: Date }[],
  now: number,
): string[] {
  const latest = new Map<string, ReminderCandidate>();
  for (const o of pending) {
    if (!o.customerKey) continue;
    const prev = latest.get(o.customerKey);
    if (!prev || o.createdAt.getTime() > prev.createdAt.getTime()) latest.set(o.customerKey, o);
  }

  const picked: string[] = [];
  for (const o of latest.values()) {
    const age = now - o.createdAt.getTime();
    if (o.reminded || age < REMIND_AFTER_MS || age > REMIND_WITHIN_MS) continue;
    const boughtSince = paid.some(
      (p) => p.customerKey === o.customerKey && p.createdAt.getTime() >= o.createdAt.getTime(),
    );
    if (!boughtSince) picked.push(o.orderId);
  }
  return picked;
}
