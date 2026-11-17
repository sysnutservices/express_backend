// Pure dealer-channel rules. Run: npx ts-node src/dealer/dealer.selftest.ts
import assert from "assert";
import {
  canTransition,
  cashLimitError,
  CatalogueEntry,
  claimError,
  formatDealerCode,
  formatDealerOrderNumber,
  istDayRange,
  normalizeDealerSerial,
  priceDealerOrder,
  validateClaim,
  validateDealerEnquiry,
  validateDealerRegistration,
  validateFulfilment,
  validatePayment,
  validatePriceInput,
  validateSerials,
} from "./logic";

let n = 0;
const check = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  ok", name);
};

const addr = { line1: "12 SP Road", city: "Bengaluru", state: "Karnataka", pincode: "560002" };
const vet = { businessType: "retail_shop", yearsInBusiness: "3to5", monthlyVolume: "6to20", interests: "Dell Latitude, ThinkPad" };
const reg = { businessName: "Laptop Point", contactName: "Ravi", gstin: "29ABCDE1234F1Z5", address: addr, ...vet, agreementVersion: "v1", noWarrantyAcknowledged: true };

check("registration: valid with GSTIN only", () => {
  const r = validateDealerRegistration(reg, { agreementVersion: "v1" });
  assert.ok(r.ok);
  if (r.ok) assert.strictEqual(r.value.gstin, "29ABCDE1234F1Z5");
});
check("registration: valid with PAN only", () => {
  const r = validateDealerRegistration({ ...reg, gstin: undefined, pan: "abcde1234f" }, { agreementVersion: "v1" });
  assert.ok(r.ok && r.value.pan === "ABCDE1234F");
});
check("registration: needs GSTIN or PAN", () => {
  const r = validateDealerRegistration({ ...reg, gstin: "" }, { agreementVersion: "v1" });
  assert.ok(!r.ok && r.errors.gstin);
});
check("registration: rejects bad GSTIN", () => {
  const r = validateDealerRegistration({ ...reg, gstin: "29ABCDE1234F1X5" }, { agreementVersion: "v1" });
  assert.ok(!r.ok && r.errors.gstin);
});
check("registration: needs current agreement and no-warranty acknowledgement", () => {
  const r = validateDealerRegistration({ ...reg, agreementVersion: "old", noWarrantyAcknowledged: false }, { agreementVersion: "v1" });
  assert.ok(!r.ok && r.errors.agreement && r.errors.noWarrantyAcknowledged);
});
check("registration: bad pincode", () => {
  const r = validateDealerRegistration({ ...reg, address: { ...addr, pincode: "012345" } }, { agreementVersion: "v1" });
  assert.ok(!r.ok && r.errors["address.pincode"]);
});
check("registration: vetting answers kept", () => {
  const r = validateDealerRegistration(reg, { agreementVersion: "v1" });
  assert.ok(r.ok);
  if (r.ok) assert.deepStrictEqual(r.value.vetting, vet);
});
check("registration: vetting answers required and must be known codes", () => {
  const r = validateDealerRegistration({ ...reg, businessType: "wholesaler", yearsInBusiness: undefined, monthlyVolume: "" }, { agreementVersion: "v1" });
  assert.ok(!r.ok && r.errors.businessType && r.errors.yearsInBusiness && r.errors.monthlyVolume);
  const ok = validateDealerRegistration({ ...reg, interests: "" }, { agreementVersion: "v1" });
  assert.ok(ok.ok && ok.value.vetting.interests === undefined); // interests optional
});

const enq = { businessName: "Laptop Point", contactName: "Ravi", city: "Bengaluru", businessType: "online_seller", monthlyVolume: "1to5", consent: true };
check("enquiry: valid, message optional and clipped", () => {
  const r = validateDealerEnquiry(enq);
  assert.ok(r.ok && r.value.message === undefined);
  const long = validateDealerEnquiry({ ...enq, message: "x".repeat(900) });
  assert.ok(long.ok && long.value.message!.length === 500);
});
check("enquiry: GSTIN optional, normalised, format-checked", () => {
  const blank = validateDealerEnquiry({ ...enq, gstin: "  " });
  assert.ok(blank.ok && blank.value.gstin === undefined);
  const ok = validateDealerEnquiry({ ...enq, gstin: "29abcde1234f1z5 " });
  assert.ok(ok.ok && ok.value.gstin === "29ABCDE1234F1Z5");
  const bad = validateDealerEnquiry({ ...enq, gstin: "29ABCDE1234F" });
  assert.ok(!bad.ok && bad.errors.gstin);
});
check("enquiry: needs consent, city, known business type and volume", () => {
  const r = validateDealerEnquiry({ ...enq, consent: "yes", city: " ", businessType: "x", monthlyVolume: 10 });
  assert.ok(!r.ok && r.errors.consent && r.errors.city && r.errors.businessType && r.errors.monthlyVolume);
  assert.ok(!validateDealerEnquiry(null).ok);
});

const cat = new Map<string, CatalogueEntry>([
  ["a", { productId: "a", title: "Dell Latitude 5410", stock: 3, pricePaise: 1800000, warranty: { months: 6, pricePaise: 100000 } }],
  ["b", { productId: "b", title: "HP ProBook 440", stock: 1, pricePaise: 1500000, warranty: null }],
]);

check("pricing: server prices lines, warranty add-on per unit", () => {
  const r = priceDealerOrder([{ productId: "a", quantity: 2, withWarranty: true }, { productId: "b", quantity: 1 }], cat);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.strictEqual(r.value.totalPaise, (1800000 + 100000) * 2 + 1500000);
  const a = r.value.lines.find((l) => l.productId === "a")!;
  assert.strictEqual(a.warrantyMonths, 6);
  assert.strictEqual(a.warrantyPricePaise, 100000);
});
check("pricing: ignores any client-sent price", () => {
  const r = priceDealerOrder([{ productId: "b", quantity: 1, unitPricePaise: 1, pricePaise: 1 }], cat);
  assert.ok(r.ok && r.value.totalPaise === 1500000);
});
check("pricing: no minimum quantity (1 unit ok)", () => {
  assert.ok(priceDealerOrder([{ productId: "a", quantity: 1 }], cat).ok);
});
check("pricing: stock checked across warranty variants", () => {
  const r = priceDealerOrder([{ productId: "a", quantity: 2, withWarranty: true }, { productId: "a", quantity: 2 }], cat);
  assert.ok(!r.ok);
});
check("pricing: duplicate lines merge", () => {
  const r = priceDealerOrder([{ productId: "a", quantity: 1 }, { productId: "a", quantity: 1 }], cat);
  assert.ok(r.ok && r.value.lines.length === 1 && r.value.lines[0].quantity === 2);
});
check("pricing: warranty only where offered", () => {
  assert.ok(!priceDealerOrder([{ productId: "b", quantity: 1, withWarranty: true }], cat).ok);
});
check("pricing: unknown product, zero/fractional qty, empty cart rejected", () => {
  assert.ok(!priceDealerOrder([{ productId: "zzz", quantity: 1 }], cat).ok);
  assert.ok(!priceDealerOrder([{ productId: "a", quantity: 0 }], cat).ok);
  assert.ok(!priceDealerOrder([{ productId: "a", quantity: 1.5 }], cat).ok);
  assert.ok(!priceDealerOrder([], cat).ok);
  assert.ok(!priceDealerOrder("x", cat).ok);
});

check("fulfilment: courier needs address, pickup doesn't", () => {
  assert.ok(validateFulfilment({ method: "pickup" }).ok);
  assert.ok(validateFulfilment({ method: "courier", address: addr }).ok);
  assert.ok(!validateFulfilment({ method: "courier" }).ok);
  assert.ok(!validateFulfilment({ method: "cod" }).ok);
});

const LIMIT = 200000 * 100;
check("cash: order of exactly Rs 2,00,000 refused", () => {
  assert.ok(cashLimitError({ orderTotalPaise: LIMIT, cashTodayPaise: 0, amountPaise: 100, limitPaise: LIMIT }));
});
check("cash: Rs 1,99,999 order ok", () => {
  assert.strictEqual(cashLimitError({ orderTotalPaise: LIMIT - 100, cashTodayPaise: 0, amountPaise: LIMIT - 100, limitPaise: LIMIT }), null);
});
check("cash: daily total across orders must stay below the limit", () => {
  assert.ok(cashLimitError({ orderTotalPaise: 10000000, cashTodayPaise: 15000000, amountPaise: 5000000, limitPaise: LIMIT }));
  assert.strictEqual(cashLimitError({ orderTotalPaise: 10000000, cashTodayPaise: 14000000, amountPaise: 5000000, limitPaise: LIMIT }), null);
});
check("cash: IST day boundaries", () => {
  // 2026-11-17 23:00 IST = 17:30 UTC; the IST day starts 2026-11-16 18:30 UTC.
  const [s, e] = istDayRange(new Date("2026-11-17T17:30:00Z"));
  assert.strictEqual(s.toISOString(), "2026-11-16T18:30:00.000Z");
  assert.strictEqual(e.toISOString(), "2026-11-17T18:30:00.000Z");
  const [s2] = istDayRange(new Date("2026-11-17T18:31:00Z")); // 00:01 IST on the 18th
  assert.strictEqual(s2.toISOString(), "2026-11-17T18:30:00.000Z");
});

check("payment: valid bank transfer", () => {
  const r = validatePayment({ method: "bank_transfer", amountPaise: 500000, reference: "UTR123" }, { outstandingPaise: 500000 });
  assert.ok(r.ok);
});
check("payment: overpayment, missing reference, bad method, future date rejected", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  assert.ok(!validatePayment({ method: "bank_transfer", amountPaise: 600000, reference: "U" }, { outstandingPaise: 500000, now }).ok);
  assert.ok(!validatePayment({ method: "cash", amountPaise: 100 }, { outstandingPaise: 500000, now }).ok);
  assert.ok(!validatePayment({ method: "razorpay", amountPaise: 100, reference: "x" }, { outstandingPaise: 500000, now }).ok);
  assert.ok(!validatePayment({ method: "cash", amountPaise: 100, reference: "R1", receivedAt: "2026-11-18T10:00:00Z" }, { outstandingPaise: 500000, now }).ok);
  assert.ok(!validatePayment({ method: "cash", amountPaise: 10.5, reference: "R1" }, { outstandingPaise: 500000, now }).ok);
});

check("serials: normalised to upper case without spaces", () => {
  assert.strictEqual(normalizeDealerSerial("  5cg 1234xyz "), "5CG1234XYZ");
  assert.strictEqual(normalizeDealerSerial("ab"), null);
  assert.strictEqual(normalizeDealerSerial(42), null);
});
check("serials: count must equal quantity and be unique in the order", () => {
  const lines = [{ _id: "l1", quantity: 2, title: "A" }, { _id: "l2", quantity: 1, title: "B" }];
  assert.ok(validateSerials(lines, [{ lineId: "l1", serials: ["SN001", "SN002"] }, { lineId: "l2", serials: ["SN003"] }]).ok);
  assert.ok(!validateSerials(lines, [{ lineId: "l1", serials: ["SN001"] }, { lineId: "l2", serials: ["SN003"] }]).ok);
  assert.ok(!validateSerials(lines, [{ lineId: "l1", serials: ["SN001", "sn001"] }, { lineId: "l2", serials: ["SN003"] }]).ok);
  assert.ok(!validateSerials(lines, [{ lineId: "l1", serials: ["SN001", "SN002"] }, { lineId: "l2", serials: ["SN002"] }]).ok);
});

check("status machine: can't skip payment or packing", () => {
  assert.ok(canTransition("placed", "paid"));
  assert.ok(!canTransition("placed", "packed"));
  assert.ok(!canTransition("placed", "dispatched"));
  assert.ok(!canTransition("paid", "dispatched"));
  assert.ok(canTransition("packed", "delivered")); // pickup
  assert.ok(!canTransition("delivered", "cancelled"));
  assert.ok(!canTransition("dispatched", "cancelled"));
});

const delivered = new Date("2026-11-10T10:00:00Z");
const day = 24 * 60 * 60 * 1000;
check("claims: damage/mismatch within 7 days of delivery only", () => {
  assert.strictEqual(claimError({ type: "transit_damage", deliveredAt: delivered, now: new Date(delivered.getTime() + 7 * day), claimWindowDays: 7 }), null);
  assert.ok(claimError({ type: "not_as_described", deliveredAt: delivered, now: new Date(delivered.getTime() + 7 * day + 1000), claimWindowDays: 7 }));
  assert.ok(claimError({ type: "transit_damage", deliveredAt: null, now: delivered, claimWindowDays: 7 }));
});
check("claims: warranty only on units bought with warranty, until it ends", () => {
  const until = new Date(delivered.getTime() + 180 * day);
  assert.ok(claimError({ type: "warranty", deliveredAt: delivered, now: new Date(delivered.getTime() + 30 * day), claimWindowDays: 7 }));
  assert.strictEqual(claimError({ type: "warranty", deliveredAt: delivered, now: new Date(delivered.getTime() + 30 * day), claimWindowDays: 7, warrantyUntil: until }), null);
  assert.ok(claimError({ type: "warranty", deliveredAt: delivered, now: new Date(until.getTime() + 1000), claimWindowDays: 7, warrantyUntil: until }));
});
check("claims: input validation", () => {
  assert.ok(validateClaim({ type: "transit_damage", serial: "sn001", description: "Screen cracked in the box" }).ok);
  assert.ok(!validateClaim({ type: "change_of_mind", serial: "SN001", description: "Don't want it any more" }).ok);
  assert.ok(!validateClaim({ type: "transit_damage", serial: "SN001", description: "short" }).ok);
  assert.ok(!validateClaim({ type: "transit_damage", serial: "SN001", description: "Screen cracked in the box", evidenceUrl: "javascript:alert(1)" }).ok);
});

check("admin price input", () => {
  assert.ok(validatePriceInput({ pricePaise: 1800000 }).ok);
  assert.ok(validatePriceInput({ pricePaise: 1800000, warranty: { months: 6, pricePaise: 0 } }).ok);
  assert.ok(!validatePriceInput({ pricePaise: 18000.5 }).ok);
  assert.ok(!validatePriceInput({ pricePaise: 1800000, warranty: { months: 0, pricePaise: 100 } }).ok);
  assert.ok(!validatePriceInput({}).ok);
});

check("codes", () => {
  assert.strictEqual(formatDealerCode(7), "DLR-0007");
  assert.strictEqual(formatDealerOrderNumber(12), "LSD-000012");
});

console.log(`dealer selftest: ${n} checks passed`);
