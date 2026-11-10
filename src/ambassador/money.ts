// Ambassador money is integer paise everywhere (see distribution/docs/06).
// Existing Order/Product fields are whole-rupee Numbers — convert only here.

export function rupeesToPaise(rupees: number): number {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function isPaise(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function formatPaise(paise: number): string {
  return "₹" + paiseToRupees(paise).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Indian mobile numbers stored as bare 10 digits. Accepts "+91 98765-43210",
// "919876543210", "09876543210". Returns null for anything else.
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string" && typeof input !== "number") return null;
  let digits = String(input).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
