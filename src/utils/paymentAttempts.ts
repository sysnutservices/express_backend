// Why an unpaid order is unpaid, in Razorpay's own words. Razorpay keeps
// every attempt a customer made against the checkout's order_ id (method,
// status, and for a failure: who failed it and why), so an abandoned
// checkout can be told apart: never tried to pay, cancelled in the UPI app,
// timed out, declined by the bank... Pure, so it can be selftested; the
// controller fetches the payments and stores the result on Order.paymentAttempts.

// The fields we read off a Razorpay payment entity.
export interface RazorpayPaymentLike {
  id: string;
  status: string; // created | authorized | captured | refunded | failed
  method?: string;
  bank?: string | null;
  wallet?: string | null;
  created_at?: number; // unix seconds
  error_code?: string | null;
  error_description?: string | null;
  error_source?: string | null;
  error_step?: string | null;
  error_reason?: string | null;
}

export interface PaymentAttemptsSummary {
  checkedAt: Date;
  count: number;
  // Short label shown next to the Abandoned badge.
  reason: string;
  // Razorpay's sentence for the last failure, when there is one.
  detail?: string;
  lastStatus?: string;
  lastMethod?: string;
  lastAt?: Date;
  errorSource?: string;
  errorReason?: string;
}

const METHOD_LABELS: Record<string, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Netbanking",
  wallet: "Wallet",
  emi: "EMI",
  cardless_emi: "Cardless EMI",
  paylater: "Pay Later",
};

export function methodLabel(p: Pick<RazorpayPaymentLike, "method" | "bank" | "wallet">): string | undefined {
  if (!p.method) return undefined;
  const base = METHOD_LABELS[p.method] || p.method;
  const extra = p.method === "netbanking" ? p.bank : p.method === "wallet" ? p.wallet : null;
  return extra ? `${base} (${extra})` : base;
}

// Razorpay's error_reason codes, grouped into what an admin needs to know.
const REASON_LABELS: [RegExp, string][] = [
  [/cancel/, "Cancelled by customer"],
  [/timed_out|timeout|expired/, "Timed out"],
  [/insufficient/, "Insufficient funds"],
  [/vpa/, "Invalid UPI ID"],
  [/incorrect_(otp|pin|cvv)|authentication|invalid_(otp|pin)|otp/, "Authentication failed"],
  [/limit/, "Limit exceeded"],
  [/risk|fraud/, "Blocked by risk check"],
  [/declin|rejected|not_allowed|blocked/, "Declined by bank"],
  [/technical|server|gateway|network|unavailable|bank_down|issuer_down/, "Bank or gateway error"],
];

function failureLabel(p: RazorpayPaymentLike): string {
  const code = `${p.error_reason || ""} ${p.error_description || ""}`.toLowerCase().replace(/\s+/g, "_");
  for (const [re, label] of REASON_LABELS) if (re.test(code)) return label;
  if (p.error_source === "customer") return "Failed at customer's end";
  if (p.error_source === "bank" || p.error_source === "issuer") return "Failed at bank";
  return "Payment failed";
}

export function summarizePaymentAttempts(payments: RazorpayPaymentLike[], now: Date = new Date()): PaymentAttemptsSummary {
  if (!payments.length) {
    return { checkedAt: now, count: 0, reason: "Never tried to pay" };
  }
  // Razorpay lists newest first, but don't rely on it.
  const sorted = [...payments].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  const captured = sorted.find((p) => p.status === "captured");
  const authorized = sorted.find((p) => p.status === "authorized");
  const last = captured || authorized || sorted[0];

  let reason: string;
  if (captured) reason = "Paid on Razorpay, not recorded";
  else if (authorized) reason = "Authorized, not captured";
  else if (last.status === "failed") reason = failureLabel(last);
  else if (last.status === "refunded") reason = "Paid, then refunded";
  else reason = "Payment started, not completed";

  const summary: PaymentAttemptsSummary = {
    checkedAt: now,
    count: payments.length,
    reason,
    lastStatus: last.status,
  };
  const method = methodLabel(last);
  if (method) summary.lastMethod = method;
  if (last.created_at) summary.lastAt = new Date(last.created_at * 1000);
  if (last.status === "failed") {
    if (last.error_description) summary.detail = last.error_description;
    if (last.error_source) summary.errorSource = last.error_source;
    if (last.error_reason) summary.errorReason = last.error_reason;
  }
  return summary;
}
