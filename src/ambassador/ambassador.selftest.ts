// Pure-logic self-check for the Sales Ambassador module — no DB, no network.
// Run: npx ts-node src/ambassador/ambassador.selftest.ts (also part of `npm test`).
import assert from "assert";
import crypto from "crypto";
import { allocateSellingPrices, commissionPerUnit, ILLUSTRATIVE_REFERRAL_SLABS, pickRule, validateRuleShape, CommissionRuleLike } from "./services/commissionCalc";
import { clampCapturedAt, decideAttribution, formatPartnerCode, normalizePartnerCode } from "./services/attribution";
import { decrypt, encrypt, encryptionConfigured, hmac, maskAccount, maskPan, maskUpi } from "./services/crypto";
import { ageOn, ruleBodyToPaise, validateLeadCreate, validateLeadUpdate, validateRegistration } from "./validation";
import { normalizePhone, rupeesToPaise } from "./money";
import { partnerFloorPaise, priceQuoteLine, quoteTotals } from "./services/quotePricing";
import { checkEligibility, payoutTotals } from "./services/payoutCalc";

const R = (r: number) => rupeesToPaise(r);
let passed = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error("FAIL:", name);
    throw e;
  }
};

const margin: CommissionRuleLike = { partnerType: "independent", kind: "margin_share", minimumPricePaise: R(24000), baseCommissionPaise: R(300), marginSharePercent: 50 };
const slab: CommissionRuleLike = { partnerType: "referral", kind: "slab", slabs: ILLUSTRATIVE_REFERRAL_SLABS };

// ---- commission maths (docs/06 §6.4 worked examples) ----
t("spec example ₹26,000 → ₹1,300", () => assert.deepStrictEqual(commissionPerUnit(margin, R(26000)), { perUnitPaise: R(1300), reason: "margin_share", needsReview: false }));
t("at floor → base only", () => assert.strictEqual(commissionPerUnit(margin, R(24000)).perUnitPaise, R(300)));
t("below floor → 0 + review", () => assert.deepStrictEqual(commissionPerUnit(margin, R(23500)), { perUnitPaise: 0, reason: "below_floor", needsReview: true }));
t("odd margin floors in Lapshark's favour", () => assert.strictEqual(commissionPerUnit(margin, R(24000) + 1).perUnitPaise, R(300)));
t("₹24,001 → ₹300.50", () => assert.strictEqual(commissionPerUnit(margin, R(24001)).perUnitPaise, R(300.5)));
t("slab ₹22,999 → ₹500", () => assert.strictEqual(commissionPerUnit(slab, R(22999)).perUnitPaise, R(500)));
t("slab boundary ₹20,000 → ₹300", () => assert.strictEqual(commissionPerUnit(slab, R(20000)).perUnitPaise, R(300)));
t("slab boundary ₹20,000.01 → ₹500", () => assert.strictEqual(commissionPerUnit(slab, R(20000) + 1).perUnitPaise, R(500)));
t("slab ₹40,000 → ₹750", () => assert.strictEqual(commissionPerUnit(slab, R(40000)).perUnitPaise, R(750)));
t("above top slab → 0 + review (admin-defined per spec)", () => assert.deepStrictEqual(commissionPerUnit(slab, R(45000)), { perUnitPaise: 0, reason: "above_slab", needsReview: true }));
t("open-ended top slab covers high prices", () => {
  const open: CommissionRuleLike = { ...slab, slabs: [...ILLUSTRATIVE_REFERRAL_SLABS, { minPricePaise: R(40000) + 1, maxPricePaise: null, commissionPaise: R(1000) }] };
  assert.strictEqual(commissionPerUnit(open, R(90000)).perUnitPaise, R(1000));
});
t("below lowest slab → 0, no review", () => assert.deepStrictEqual(commissionPerUnit(slab, R(12000)), { perUnitPaise: 0, reason: "below_slab", needsReview: false }));
t("no rule → review", () => assert.deepStrictEqual(commissionPerUnit(null, R(30000)), { perUnitPaise: 0, reason: "no_rule", needsReview: true }));

// ---- coupon allocation ----
t("single line coupon", () => {
  const [l] = allocateSellingPrices([{ itemId: "a", unitPricePaise: R(25200), quantity: 1 }], R(500));
  assert.strictEqual(l.unitSellingPricePaise, R(24700));
  assert.strictEqual(commissionPerUnit(slab, l.unitSellingPricePaise).perUnitPaise, R(500));
});
t("pro-rata shares sum exactly to coupon", () => {
  const lines = allocateSellingPrices(
    [
      { itemId: "a", unitPricePaise: R(21000), quantity: 2 },
      { itemId: "b", unitPricePaise: R(15333), quantity: 1 },
      { itemId: "c", unitPricePaise: R(999), quantity: 3 },
    ],
    R(1001)
  );
  assert.strictEqual(lines.reduce((s, l) => s + l.couponSharePaise, 0), R(1001));
  assert.ok(lines.every((l) => l.couponSharePaise >= 0 && l.couponSharePaise <= l.lineGrossPaise));
});
t("coupon larger than order is capped", () => {
  const [l] = allocateSellingPrices([{ itemId: "a", unitPricePaise: R(100), quantity: 1 }], R(500));
  assert.strictEqual(l.unitSellingPricePaise, 0);
});
t("qty 2 → per unit × 2", () => {
  const [l] = allocateSellingPrices([{ itemId: "a", unitPricePaise: R(21000), quantity: 2 }], 0);
  assert.strictEqual(commissionPerUnit(slab, l.unitSellingPricePaise).perUnitPaise * l.quantity, R(1000));
});

// ---- rule selection + validation ----
t("SKU rule beats default; retired/expired ignored", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  const rules: any[] = [
    { _id: 1, partnerType: "referral", productId: null, kind: "slab", status: "active" },
    { _id: 2, partnerType: "referral", productId: "p1", kind: "slab", status: "active" },
    { _id: 3, partnerType: "referral", productId: "p2", kind: "slab", status: "retired" },
    { _id: 4, partnerType: "referral", productId: "p3", kind: "slab", status: "active", validUntil: new Date("2026-11-01") },
    { _id: 5, partnerType: "independent", productId: "p1", kind: "slab", status: "active" },
  ];
  assert.strictEqual(pickRule(rules, "referral", "p1", now)?._id, 2);
  assert.strictEqual(pickRule(rules, "referral", "p2", now)?._id, 1);
  assert.strictEqual(pickRule(rules, "referral", "p3", now)?._id, 1);
  assert.strictEqual(pickRule(rules, "independent", "p9", now), null);
});
t("rule validation", () => {
  assert.deepStrictEqual(validateRuleShape(slab), {});
  assert.deepStrictEqual(validateRuleShape(margin), {});
  assert.ok(validateRuleShape({ ...slab, slabs: [ILLUSTRATIVE_REFERRAL_SLABS[1], ILLUSTRATIVE_REFERRAL_SLABS[0]] }).slabs);
  assert.ok(validateRuleShape({ ...slab, slabs: [{ minPricePaise: 0, maxPricePaise: null, commissionPaise: 1 }, { minPricePaise: 5, maxPricePaise: null, commissionPaise: 1 }] }).slabs);
  assert.ok(validateRuleShape({ ...margin, marginSharePercent: 101 }).marginSharePercent);
  assert.ok(validateRuleShape({ ...margin, minimumPricePaise: 1.5 }).minimumPricePaise);
  assert.ok(validateRuleShape({ ...margin, kind: "bogus" as any }).kind);
});
t("rule body rupees → paise", () => {
  const b = ruleBodyToPaise({ partnerType: "independent", kind: "margin_share", minimumPrice: 24000, baseCommission: "300", marginSharePercent: 50 });
  assert.strictEqual(b.minimumPricePaise, R(24000));
  assert.strictEqual(b.baseCommissionPaise, R(300));
  assert.deepStrictEqual(validateRuleShape(b as any), {});
});

// ---- attribution ----
const d = (iso: string) => new Date(iso);
const partners = { A: { userId: "uA", phone: "9000000001" }, B: { userId: "uB", phone: "9000000002" } };
const buyer = { userId: "uC", phones: ["9876543210"] };
t("single referral link", () => {
  const r = decideAttribution({ candidates: [{ ambassadorId: "A", type: "referral_link", at: d("2026-11-01") }], partners, buyer, buyerFirstPriorPaidOrderAt: null })!;
  assert.strictEqual(r.winner.ambassadorId, "A");
  assert.deepStrictEqual(r.holds, []);
});
t("earliest source wins; conflict held", () => {
  const r = decideAttribution({
    candidates: [
      { ambassadorId: "A", type: "referral_link", at: d("2026-11-05") },
      { ambassadorId: "B", type: "lead", at: d("2026-11-02"), leadId: "L1" },
    ],
    partners,
    buyer,
    buyerFirstPriorPaidOrderAt: null,
  })!;
  assert.strictEqual(r.winner.ambassadorId, "B");
  assert.deepStrictEqual(r.conflictWith, ["A"]);
  assert.deepStrictEqual(r.holds, ["attribution_conflict"]);
});
t("same partner via link and lead is not a conflict", () => {
  const r = decideAttribution({
    candidates: [
      { ambassadorId: "A", type: "lead", at: d("2026-11-02") },
      { ambassadorId: "A", type: "referral_link", at: d("2026-11-05") },
    ],
    partners,
    buyer,
    buyerFirstPriorPaidOrderAt: null,
  })!;
  assert.deepStrictEqual(r.conflictWith, []);
  assert.deepStrictEqual(r.holds, []);
});
t("tie → referral link first, deterministic", () => {
  const at = d("2026-11-02");
  const r = decideAttribution({ candidates: [{ ambassadorId: "B", type: "lead", at }, { ambassadorId: "A", type: "referral_link", at }], partners, buyer, buyerFirstPriorPaidOrderAt: null })!;
  assert.strictEqual(r.winner.ambassadorId, "A");
});
t("self-referral by userId and by phone", () => {
  const c = [{ ambassadorId: "A", type: "referral_link" as const, at: d("2026-11-01") }];
  assert.deepStrictEqual(decideAttribution({ candidates: c, partners, buyer: { userId: "uA", phones: [] }, buyerFirstPriorPaidOrderAt: null })!.holds, ["self_referral"]);
  assert.deepStrictEqual(decideAttribution({ candidates: c, partners, buyer: { userId: "uZ", phones: ["9000000001"] }, buyerFirstPriorPaidOrderAt: null })!.holds, ["self_referral"]);
});
t("existing customer only if prior order predates the source", () => {
  const c = [{ ambassadorId: "A", type: "referral_link" as const, at: d("2026-11-05") }];
  assert.deepStrictEqual(decideAttribution({ candidates: c, partners, buyer, buyerFirstPriorPaidOrderAt: d("2026-10-01") })!.holds, ["existing_customer"]);
  assert.deepStrictEqual(decideAttribution({ candidates: c, partners, buyer, buyerFirstPriorPaidOrderAt: d("2026-11-06") })!.holds, []);
});
t("no candidates → null", () => assert.strictEqual(decideAttribution({ candidates: [], partners, buyer, buyerFirstPriorPaidOrderAt: null }), null));
t("capturedAt clamped to window", () => {
  const order = d("2026-11-10T00:00:00Z");
  assert.deepStrictEqual(clampCapturedAt("2026-12-01", order, 30), order); // future → order time
  assert.deepStrictEqual(clampCapturedAt("2020-01-01", order, 30), d("2026-10-11T00:00:00Z"));
  assert.deepStrictEqual(clampCapturedAt("garbage", order, 30), order);
  assert.deepStrictEqual(clampCapturedAt(undefined, order, 30), order);
});
t("partner codes", () => {
  assert.strictEqual(formatPartnerCode(1), "LSA-000101");
  assert.strictEqual(normalizePartnerCode(" lsa-000101 "), "LSA-000101");
  assert.strictEqual(normalizePartnerCode("LSA-101"), null);
  assert.strictEqual(normalizePartnerCode({ $ne: 1 }), null);
});

// ---- crypto ----
t("encryption fails closed without keys", () => {
  const saved = [process.env.AMBASSADOR_ENC_KEY, process.env.AMBASSADOR_HASH_KEY];
  delete process.env.AMBASSADOR_ENC_KEY;
  delete process.env.AMBASSADOR_HASH_KEY;
  assert.strictEqual(encryptionConfigured(), false);
  assert.throws(() => encrypt("x"));
  [process.env.AMBASSADOR_ENC_KEY, process.env.AMBASSADOR_HASH_KEY] = saved;
});
t("AES-GCM round trip, random IV, tamper detected", () => {
  process.env.AMBASSADOR_ENC_KEY = crypto.randomBytes(32).toString("base64");
  process.env.AMBASSADOR_HASH_KEY = crypto.randomBytes(32).toString("base64");
  const a = encrypt("ABCDE1234F");
  assert.notStrictEqual(a, encrypt("ABCDE1234F"));
  assert.strictEqual(decrypt(a), "ABCDE1234F");
  const parts = a.split(":");
  parts[3] = Buffer.from("ZZZZZZZZZZ").toString("base64");
  assert.throws(() => decrypt(parts.join(":")));
  assert.strictEqual(hmac("pan:X"), hmac("pan:X"));
  assert.notStrictEqual(hmac("pan:X"), hmac("pan:Y"));
});
t("masking", () => {
  assert.strictEqual(maskPan("ABCDE1234F"), "XXXXXX234F");
  assert.strictEqual(maskAccount("123456789012"), "XXXX9012");
  assert.strictEqual(maskUpi("rahul.k@okhdfc"), "ra***@okhdfc");
});

// ---- validation ----
const goodReg = {
  partnerType: "referral",
  fullName: "Asha Rao",
  email: "Asha@Example.com",
  dateOfBirth: "1995-04-20",
  address: { line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
  pan: "abcde1234f",
  payout: { method: "upi", upiId: "asha@okicici" },
  agreementVersion: "v1",
  acceptAgreement: true,
};
const regOpts = { minimumAge: 18, agreementVersion: "v1", now: new Date("2026-11-10T00:00:00Z") };
t("registration ok + normalised", () => {
  const r = validateRegistration(goodReg, regOpts);
  assert.ok(r.ok);
  if (r.ok) {
    assert.strictEqual(r.value.email, "asha@example.com");
    assert.strictEqual(r.value.pan, "ABCDE1234F");
  }
});
t("under 18 rejected (day before 18th birthday)", () => {
  const r = validateRegistration({ ...goodReg, dateOfBirth: "2008-11-11" }, regOpts);
  assert.ok(!r.ok && r.errors.dateOfBirth);
  assert.ok(validateRegistration({ ...goodReg, dateOfBirth: "2008-11-10" }, regOpts).ok);
});
t("age calc", () => assert.strictEqual(ageOn(new Date("2000-02-29T00:00:00Z"), new Date("2018-02-28T00:00:00Z")), 17));
t("registration rejects bad PAN/IFSC/agreement/type", () => {
  const r = validateRegistration({ ...goodReg, pan: "12345", payout: { method: "bank", accountName: "A", accountNumber: "12", ifsc: "BAD" }, acceptAgreement: false, agreementVersion: "old", partnerType: "admin" }, regOpts);
  assert.ok(!r.ok);
  if (!r.ok) for (const k of ["pan", "payout.accountNumber", "payout.ifsc", "acceptAgreement", "agreementVersion", "partnerType"]) assert.ok(r.errors[k], k);
});
t("registration ignores injected fields", () => {
  const r = validateRegistration({ ...goodReg, status: "active", partnerCode: "LSA-999999", phone: "9999999999" }, regOpts);
  assert.ok(r.ok);
  if (r.ok) assert.ok(!("status" in r.value) && !("partnerCode" in r.value) && !("phone" in r.value));
});
t("phones", () => {
  assert.strictEqual(normalizePhone("+91 98765-43210"), "9876543210");
  assert.strictEqual(normalizePhone("09876543210"), "9876543210");
  assert.strictEqual(normalizePhone("12345"), null);
  assert.strictEqual(normalizePhone("5876543210"), null);
  assert.strictEqual(normalizePhone({ $gt: "" } as any), null);
});
t("lead create needs consent, valid phone", () => {
  const r = validateLeadCreate({ customerName: "Ravi", phone: "98765 43210", budget: "30000", consent: true });
  assert.ok(r.ok && r.value.phone === "9876543210" && r.value.budgetPaise === R(30000));
  const bad = validateLeadCreate({ customerName: "", phone: "1", consent: false });
  assert.ok(!bad.ok && bad.errors.consent && bad.errors.phone && bad.errors.customerName);
});
t("lead update cannot set won", () => {
  const r = validateLeadUpdate({ status: "won" });
  assert.ok(!r.ok && r.errors.status);
  assert.ok(validateLeadUpdate({ status: "qualified" }).ok);
  assert.ok(!validateLeadUpdate({}).ok);
});

// ---- add-ons at face value (D13) ----
t("add-on raises the margin floor: ₹26,000 + ₹4,000 SSD → still ₹1,300", () => assert.strictEqual(commissionPerUnit(margin, R(30000), R(4000)).perUnitPaise, R(1300)));
t("discount hidden in an add-on is below floor", () => assert.strictEqual(commissionPerUnit(margin, R(27000), R(4000)).reason, "below_floor"));
t("slab ignores add-on split", () => assert.strictEqual(commissionPerUnit(slab, R(22999), R(4000)).perUnitPaise, R(500)));

// ---- quotation pricing levels (docs/01 pricing authority) ----
const line = (quoted: number, over: any = {}) => priceQuoteLine({ listedUnitPaise: R(28000), configCostPaise: 0, quotedUnitPaise: R(quoted), quantity: 1, rule: margin, ...over });
t("level 1 at listed price", () => { const r = line(28000); assert.ok(r.ok && r.value.level === 1 && r.value.estCommissionPerUnitPaise === R(2300)); });
t("level 2 between floor and listed", () => { const r = line(26000); assert.ok(r.ok && r.value.level === 2 && r.value.estCommissionPerUnitPaise === R(1300) && r.value.discountUnitPaise === R(2000)); });
t("level 2 exactly at floor", () => { const r = line(24000); assert.ok(r.ok && r.value.level === 2 && r.value.floorUnitPaise === R(24000)); });
t("level 3 below floor, commission 0", () => { const r = line(23000); assert.ok(r.ok && r.value.level === 3 && r.value.estCommissionPerUnitPaise === 0 && r.value.calcReason === "below_floor"); });
t("no floor configured → any discount is level 3", () => { const r = line(27999, { rule: null }); assert.ok(r.ok && r.value.level === 3 && r.value.floorUnitPaise === null); });
t("no rule, listed price → level 1", () => { const r = line(28000, { rule: null }); assert.ok(r.ok && r.value.level === 1 && r.value.calcReason === "no_rule"); });
t("above listed rejected", () => assert.ok(!line(28001).ok));
t("paise prices rejected (orders are whole rupees)", () => assert.ok(!priceQuoteLine({ listedUnitPaise: R(28000), configCostPaise: 0, quotedUnitPaise: R(26000) + 50, quantity: 1, rule: margin }).ok));
t("zero / negative / bad qty rejected", () => {
  assert.ok(!line(0).ok);
  assert.ok(!priceQuoteLine({ listedUnitPaise: R(28000), configCostPaise: 0, quotedUnitPaise: R(26000), quantity: 6, rule: margin }).ok);
  assert.ok(!priceQuoteLine({ listedUnitPaise: R(28000), configCostPaise: 0, quotedUnitPaise: R(26000), quantity: 1.5, rule: margin }).ok);
});
t("floor includes add-ons, capped at listed", () => {
  assert.strictEqual(partnerFloorPaise(margin, R(32000), R(4000)), R(28000));
  assert.strictEqual(partnerFloorPaise(margin, R(20000), 0), R(20000));
  assert.strictEqual(partnerFloorPaise(slab, R(20000), 0), null);
});
t("with add-on: ₹28,000 on a ₹32,000 + SSD line is level 2 at base commission", () => {
  const r = priceQuoteLine({ listedUnitPaise: R(32000), configCostPaise: R(4000), quotedUnitPaise: R(28000), quantity: 1, rule: margin });
  assert.ok(r.ok && r.value.level === 2 && r.value.estCommissionPerUnitPaise === R(300));
});
t("quote totals use approved commission override", () => {
  const tot = quoteTotals([
    { listedUnitPaise: R(28000), quotedUnitPaise: R(26000), quantity: 2, estCommissionPerUnitPaise: R(1300) },
    { listedUnitPaise: R(28000), quotedUnitPaise: R(23000), quantity: 1, estCommissionPerUnitPaise: 0, approvedCommissionPerUnitPaise: R(200) },
  ]);
  assert.deepStrictEqual(tot, { listedPaise: R(84000), quotedPaise: R(75000), discountPaise: R(9000), estCommissionPaise: R(2800) });
});

// ---- Phase 3: eligibility + payout totals ----
{
  const now = new Date("2026-12-01T00:00:00Z");
  const day = 86400000;
  const okOrder = { status: "Delivered", paymentStatus: "Paid", paymentMethod: "Razorpay", total: 26000, advanceAmount: 0, shipment: { deliveredAt: new Date(now.getTime() - 15 * day) } };
  const base = { now, holdDays: 14, commission: { status: "delivery_confirmed", hold: null, deliveredAt: null }, order: okOrder, partnerStatus: "active" };
  const reason = (over: any) => { const r = checkEligibility({ ...base, ...over }); return r.eligible ? "eligible" : r.reason; };
  t("eligible after the 14-day hold", () => assert.strictEqual(reason({}), "eligible"));
  t("inside the hold → hold_period with date", () => {
    const r = checkEligibility({ ...base, order: { ...okOrder, shipment: { deliveredAt: new Date(now.getTime() - 3 * day) } } });
    assert.ok(!r.eligible && r.reason === "hold_period" && r.eligibleFrom!.getTime() === now.getTime() + 11 * day);
  });
  t("hold 0 days → eligible at delivery", () => assert.strictEqual(reason({ holdDays: 0, order: { ...okOrder, shipment: { deliveredAt: now } } }), "eligible"));
  t("COD balance not collected", () => assert.strictEqual(reason({ order: { ...okOrder, paymentMethod: "COD", advanceAmount: 500 } }), "cod_not_collected"));
  t("COD collected", () => assert.strictEqual(reason({ order: { ...okOrder, paymentMethod: "COD", advanceAmount: 500, codCollected: { at: now } } }), "eligible"));
  t("COD fully prepaid (small order)", () => assert.strictEqual(reason({ order: { ...okOrder, paymentMethod: "COD", total: 400, advanceAmount: 400 } }), "eligible"));
  t("open cancellation", () => assert.strictEqual(reason({ order: { ...okOrder, cancellation: { status: "Requested" } } }), "cancellation_open"));
  t("rejected cancellation is fine", () => assert.strictEqual(reason({ order: { ...okOrder, cancellation: { status: "Rejected" } } }), "eligible"));
  t("refund", () => assert.strictEqual(reason({ order: { ...okOrder, refund: { id: "rfnd_1" } } }), "refunded"));
  t("not delivered", () => assert.strictEqual(reason({ order: { ...okOrder, status: "Shipped" } }), "not_delivered"));
  t("partner suspended", () => assert.strictEqual(reason({ partnerStatus: "suspended" }), "partner_not_active"));
  t("on hold", () => assert.strictEqual(reason({ commission: { status: "delivery_confirmed", hold: { reason: "manual" } } }), "on_hold"));
  t("payout totals: commission − clawback − TDS", () => assert.deepStrictEqual(payoutTotals([R(3300)], [-R(1300)], 10), { grossPaise: R(3300), adjustmentsPaise: -R(1300), tdsPercent: 10, tdsPaise: R(200), netPaise: R(1800) }));
  t("payout totals: TDS floors to the paisa", () => assert.strictEqual(payoutTotals([1001], [], 5).tdsPaise, 50));
  t("payout totals: clawback larger than commission → net ≤ 0, no TDS", () => { const x = payoutTotals([R(500)], [-R(1300)], 10); assert.ok(x.netPaise < 0 && x.tdsPaise === 0); });
  t("payout totals: TDS clamped to 0-30%", () => assert.strictEqual(payoutTotals([R(100)], [], 99).tdsPercent, 30));
}

console.log(`ambassador.selftest: ${passed} checks passed`);
