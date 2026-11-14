// End-to-end check of the ambassador module against a REAL MongoDB — but
// only a throwaway local one. Never reads MONGO_URI (that is production).
//
//   AMBASSADOR_TEST_MONGO_URI="mongodb://localhost:27099/lapshark_ambassador_test?replicaSet=rs0&directConnection=true" \
//     npx ts-node src/ambassador/integration.selftest.ts
//
// See distribution/docs/09-testing-deployment.md for the Docker one-liner.
import assert from "assert";
import crypto from "crypto";
import type { AddressInfo } from "net";

const URI = process.env.AMBASSADOR_TEST_MONGO_URI || "";
{
  const u = new URL(URI || "mongodb://invalid");
  const db = u.pathname.replace(/^\//, "");
  if (!URI || !["localhost", "127.0.0.1"].includes(u.hostname) || !db.endsWith("_test")) {
    console.error("Refusing to run: AMBASSADOR_TEST_MONGO_URI must point at localhost and a database ending in _test.");
    process.exit(2);
  }
}
// Set BEFORE any module runs dotenv.config() (dotenv never overrides).
process.env.JWT_SECRET = "integration-test-secret-" + crypto.randomBytes(8).toString("hex");
process.env.AMBASSADOR_ENC_KEY = crypto.randomBytes(32).toString("base64");
process.env.AMBASSADOR_HASH_KEY = crypto.randomBytes(32).toString("base64");

/* eslint-disable @typescript-eslint/no-var-requires */
async function main() {
  // createOrder talks to Razorpay: stub the SDK so the test never makes a
  // network call or creates a real payment order.
  const rzpPath = require.resolve("razorpay");
  class FakeRazorpay {
    orders = { create: async (o: any) => ({ id: "order_test_" + crypto.randomBytes(4).toString("hex"), ...o }) };
  }
  require.cache[rzpPath] = { id: rzpPath, filename: rzpPath, loaded: true, exports: FakeRazorpay } as any;
  const mongoose = (await import("mongoose")).default;
  const express = (await import("express")).default;
  const jwt = (await import("jsonwebtoken")).default;
  const User = (await import("../models/User")).default;
  const Product = (await import("../models/Product")).default;
  const Order = (await import("../models/Order")).default;
  const AuditLog = (await import("../models/AuditLog")).default;
  const AmbassadorProfile = (await import("./models/AmbassadorProfile")).default;
  const AmbassadorLead = (await import("./models/AmbassadorLead")).default;
  const AmbassadorCommission = (await import("./models/AmbassadorCommission")).default;
  const AmbassadorCommissionRule = (await import("./models/AmbassadorCommissionRule")).default;
  const routes = (await import("./routes")).default;
  const { createOrder } = await import("../controllers/orderController");
  const { clearSettingsCache } = await import("./services/settings");
  const { resolveReferralForNewOrder, syncOrderCommissions } = await import("./services/orderHooks");
  const AmbassadorQuotation = (await import("./models/AmbassadorQuotation")).default;
  const { loadQuoteForCheckout } = await import("./services/quoteService");
  const AmbassadorPayout = (await import("./models/AmbassadorPayout")).default;
  const AmbassadorAdjustment = (await import("./models/AmbassadorAdjustment")).default;
  // The ₹20,001-₹25,000 slab of the admin template these steps activate —
  // read from the template so a rate change doesn't break the checks.
  const TEMPLATE_SLAB_20_25K = (await import("./services/commissionCalc")).ILLUSTRATIVE_REFERRAL_SLABS[1].commissionPaise;

  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m: any) => m.syncIndexes()));

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", routes);
  app.post("/api/orders/create", createOrder); // no auth: guest-style order (userId null)
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  let passed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      clearSettingsCache();
      await fn();
      passed++;
      console.log("  ok -", name);
    } catch (e) {
      console.error("FAIL -", name);
      throw e;
    }
  };

  const mkUser = async (mobile: string, role: "admin" | "customer" = "customer", staffRole?: string) =>
    User.create({ mobile, name: `U${mobile.slice(-3)}`, role, ...(staffRole ? { staffRole } : {}), email: role === "admin" ? `a${mobile}@x.test` : undefined });
  const tok = (u: any) => jwt.sign({ id: String(u._id), name: u.name, role: u.role, tokenVersion: 0 }, process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: "1h" });
  const call = async (method: string, path: string, user?: any, body?: any) => {
    const r = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(user ? { authorization: `Bearer ${tok(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };

  const superA = await mkUser("9100000001", "admin");
  const sales = await mkUser("9100000002", "admin", "sales_admin");
  const ops = await mkUser("9100000003", "admin", "operations");
  const finance = await mkUser("9100000004", "admin", "finance");
  const uA = await mkUser("9200000001");
  const uB = await mkUser("9200000002");
  const uC = await mkUser("9200000003");
  const buyer1 = await mkUser("9300000001");
  const buyer2 = await mkUser("9300000002");
  const buyer3 = await mkUser("9300000003");
  const buyer4 = await mkUser("9300000004");

  const p1 = await Product.create({ productId: "P1", title: "ThinkPad T480", brand: "Lenovo", category: "Business Laptops", description: "d", price: 30000, finalPrice: 22999, stock: 5, image: "x.jpg", specs: { processor: "i5" } });
  const p2 = await Product.create({ productId: "P2", title: "Precision 5550", brand: "Dell", category: "Workstations", description: "d", price: 60000, finalPrice: 45000, stock: 1, image: "y.jpg" });
  await Product.create({ productId: "P3", title: "Sold out", brand: "HP", category: "Business Laptops", description: "d", price: 1, finalPrice: 1, stock: 0, image: "z.jpg" });

  const reg = (over: any = {}) => ({
    partnerType: "referral",
    fullName: "Asha Rao",
    email: "asha@example.com",
    dateOfBirth: "1995-04-20",
    address: { line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    pan: "ABCDE1234F",
    payout: { method: "upi", upiId: "asha@okicici" },
    agreementVersion: "2026-11-draft",
    acceptAgreement: true,
    ...over,
  });

  let A: any, B: any;
  const R = (r: number) => r * 100;

  console.log("ambassador integration:");

  await step("programme disabled → register 503, public programme readable", async () => {
    assert.strictEqual((await call("POST", "/partners/register", uA, reg())).status, 503);
    const p = await call("GET", "/partners/programme");
    assert.strictEqual(p.status, 200);
    assert.strictEqual(p.body.programmeEnabled, false);
  });

  await step("settings: only super admin can change; validation", async () => {
    assert.strictEqual((await call("PUT", "/admin/partner-settings", ops, { programmeEnabled: true })).status, 403);
    assert.strictEqual((await call("PUT", "/admin/partner-settings", buyer1, { programmeEnabled: true })).status, 403);
    assert.strictEqual((await call("PUT", "/admin/partner-settings", superA, { leadOwnershipDays: 0 })).status, 400);
    const r = await call("PUT", "/admin/partner-settings", superA, { programmeEnabled: true, pilotAllowlist: ["9200000001", "+91 92000 00002"] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.settings.pilotAllowlist, ["9200000001", "9200000002"]);
    assert.ok(await AuditLog.exists({ action: "ambassador.settings.update" }));
  });

  await step("registration: allowlist gate, encryption at rest, masking", async () => {
    assert.strictEqual((await call("POST", "/partners/register", uC, reg({ email: "c@example.com", pan: "CCCCC1111C" }))).status, 403);
    const r = await call("POST", "/partners/register", uA, reg());
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    A = r.body.profile;
    assert.match(A.partnerCode, /^LSA-\d{6}$/);
    assert.strictEqual(A.pan.masked, "XXXXXX234F");
    assert.ok(!JSON.stringify(r.body).includes("ABCDE1234F") && !JSON.stringify(r.body).includes("asha@okicici"));
    const raw: any = await AmbassadorProfile.findById(A._id).lean();
    assert.ok(raw.pan.encrypted.startsWith("v1:") && !raw.pan.encrypted.includes("ABCDE"));
    assert.strictEqual(raw.phone, "9200000001", "mobile comes from the verified account, not the body");
    const rb = await call("POST", "/partners/register", uB, reg({ partnerType: "independent", fullName: "Bala K", email: "bala@example.com", pan: "BBBBB2222B", payout: { method: "bank", accountName: "Bala K", accountNumber: "123456789012", ifsc: "HDFC0001234" } }));
    assert.strictEqual(rb.status, 201, JSON.stringify(rb.body));
    B = rb.body.profile;
    assert.strictEqual(B.payout.masked, "XXXX9012 · HDFC0001234");
  });

  await step("duplicate registration: same user, same PAN", async () => {
    assert.strictEqual((await call("POST", "/partners/register", uA, reg())).status, 409);
    await call("PUT", "/admin/partner-settings", superA, { pilotAllowlist: ["9200000001", "9200000002", "9200000003"] });
    clearSettingsCache();
    const r = await call("POST", "/partners/register", uC, reg({ email: "c@example.com" }));
    assert.strictEqual(r.status, 409);
    assert.ok(r.body.errors?.pan);
  });

  await step("unapproved partner cannot use partner APIs", async () => {
    const r = await call("GET", "/partners/dashboard", uA);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.code, "PARTNER_NOT_ACTIVE");
    assert.strictEqual((await call("GET", "/partners/dashboard", buyer1)).status, 404);
  });

  await step("approval: role isolation, audit, orientation → active", async () => {
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/approve`, ops)).status, 403);
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/approve`, buyer1)).status, 403);
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/reject`, sales, {})).status, 400, "reject needs a reason");
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/approve`, sales)).status, 200);
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/approve`, sales)).status, 409, "no double approve");
    assert.strictEqual((await call("PATCH", `/admin/partners/${B._id}/approve`, superA)).status, 200);
    assert.ok(await AuditLog.exists({ action: "ambassador.partner.approve", targetId: String(A._id) }));
    assert.strictEqual((await call("POST", "/partners/orientation/complete", uA)).status, 200);
    assert.strictEqual((await call("POST", "/partners/orientation/complete", uA)).status, 403, "already active");
    assert.strictEqual((await call("POST", "/partners/orientation/complete", uB)).status, 200);
    const prof = await call("GET", "/partners/profile", uA);
    assert.strictEqual(prof.body.profile.status, "active");
  });

  await step("referral link + public code check", async () => {
    const r = await call("GET", "/partners/referral-link", uA);
    assert.strictEqual(r.body.url, `https://lapshark.com/?ref=${A.partnerCode}`);
    assert.deepStrictEqual((await call("GET", `/partners/referral/${A.partnerCode.toLowerCase()}`)).body, { valid: true });
    assert.deepStrictEqual((await call("GET", "/partners/referral/LSA-999999")).body, { valid: false });
  });

  let refRuleId = "";
  await step("commission rules: super only, versioning, preview", async () => {
    const template = (await call("GET", "/admin/commission-rules", finance)).body.template;
    assert.strictEqual((await call("POST", "/admin/commission-rules", sales, template)).status, 403);
    const r = await call("POST", "/admin/commission-rules", superA, template);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    refRuleId = r.body.rule._id;
    const ind = await call("POST", "/admin/commission-rules", superA, { partnerType: "independent", kind: "margin_share", minimumPrice: 21000, baseCommission: 250, marginSharePercent: 40 });
    assert.strictEqual(ind.status, 201);
    const v2 = await call("PATCH", `/admin/commission-rules/${ind.body.rule._id}`, superA, { minimumPrice: 20000, baseCommission: 300, marginSharePercent: 50 });
    assert.strictEqual(v2.status, 201, JSON.stringify(v2.body));
    assert.strictEqual(v2.body.rule.version, 2);
    assert.strictEqual(v2.body.retired.status, "retired");
    assert.strictEqual(await AmbassadorCommissionRule.countDocuments({ partnerType: "independent", status: "active" }), 1);
    assert.strictEqual((await call("PATCH", `/admin/commission-rules/${ind.body.rule._id}`, superA, { baseCommission: 1 })).status, 409, "retired version is immutable");
    const bad = await call("POST", "/admin/commission-rules", superA, { partnerType: "referral", kind: "margin_share", minimumPrice: -5, baseCommission: 1, marginSharePercent: 200 });
    assert.strictEqual(bad.status, 400);
    const pv = await call("POST", "/admin/commission-rules/preview", sales, { partnerType: "independent", sellingPrice: 26000 });
    assert.strictEqual(pv.body.commission, 3300); // 300 + 50% of 6000
  });

  await step("catalogue: in-stock only, whitelisted fields, floor only for independent", async () => {
    const a = await call("GET", "/partners/products", uA);
    assert.strictEqual(a.body.count, 2);
    assert.ok(a.body.products.every((p: any) => !("partnerMinimumPrice" in p) && !("stock" in p) && !("description" in p)));
    const b = await call("GET", "/partners/products", uB);
    assert.ok(b.body.products.every((p: any) => p.partnerMinimumPrice === 20000));
  });

  let leadB = "";
  await step("leads: create, ownership conflict, IDOR, partner can't mark won", async () => {
    assert.strictEqual((await call("POST", "/partners/leads", uB, { customerName: "Ravi", phone: "9300000002", consent: false })).status, 400);
    const r = await call("POST", "/partners/leads", uB, { customerName: "Ravi", phone: "+91 93000 00002", budget: 30000, consent: true });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    leadB = r.body.lead._id;
    const clash = await call("POST", "/partners/leads", uA, { customerName: "Ravi", phone: "9300000002", consent: true });
    assert.strictEqual(clash.status, 409);
    assert.ok(!JSON.stringify(clash.body).includes(B.partnerCode) && !JSON.stringify(clash.body).includes("Bala"));
    assert.strictEqual((await call("POST", "/partners/leads", uB, { customerName: "Ravi", phone: "9300000002", consent: true })).body.existingLeadId, leadB);
    assert.strictEqual((await call("GET", `/partners/leads/${leadB}`, uA)).status, 404);
    assert.strictEqual((await call("PATCH", `/partners/leads/${leadB}`, uA, { status: "lost" })).status, 404);
    assert.strictEqual((await call("PATCH", `/partners/leads/${leadB}`, uB, { status: "won" })).status, 400);
    const up = await call("PATCH", `/partners/leads/${leadB}`, uB, { status: "qualified", followUpAt: "2026-12-01T10:00:00Z" });
    assert.strictEqual(up.status, 200);
    const detail = await call("GET", `/partners/leads/${leadB}`, uB);
    assert.ok(detail.body.activities.some((x: any) => x.type === "status_changed"));
    assert.strictEqual((await call("POST", "/partners/leads", uA, { customerName: "Me", phone: "9200000001", consent: true })).status, 400, "own number");
  });

  const mkOrder = async (buyer: any, items: { p: any; price: number; qty?: number; extra?: any }[], extra: any = {}): Promise<any> =>
    (Order as any).create({
      orderId: "LS-T-" + crypto.randomBytes(3).toString("hex"),
      customerName: buyer.name,
      userId: buyer._id,
      date: new Date().toISOString(),
      total: items.reduce((s, i) => s + i.price * (i.qty || 1), 0) - (extra.couponValue || 0),
      paymentMethod: "Razorpay",
      paymentStatus: "Paid",
      status: "Processing",
      razorpayOrderId: "order_" + crypto.randomBytes(4).toString("hex"),
      shippingAddress: { street: "s", city: "Bengaluru", state: "KA", zip: "560001", phone: extra.shipPhone || buyer.mobile, type: "Home" },
      items: items.map((i) => ({ productId: i.p._id, title: i.p.title, quantity: i.qty || 1, finalPrice: i.price, image: "x", ...(i.extra || {}) })),
      ...extra,
    });

  let order1: any;
  await step("referral-link order: 2 lines, coupon pro-rata, above-slab held, idempotent", async () => {
    assert.strictEqual(await resolveReferralForNewOrder(A.partnerCode, new Date().toISOString(), String(uA._id)), undefined, "own link ignored");
    assert.strictEqual(await resolveReferralForNewOrder("LSA-999999", undefined, null), undefined);
    const ref = await resolveReferralForNewOrder(A.partnerCode.toLowerCase(), new Date(Date.now() - 86400000).toISOString(), String(buyer1._id));
    assert.ok(ref && String(ref.ambassadorId) === String(A._id));
    order1 = await mkOrder(buyer1, [{ p: p1, price: 22999 }, { p: p2, price: 45000 }], { couponValue: 680, ambassadorRef: ref });
    const s1 = await syncOrderCommissions(order1._id);
    assert.strictEqual(s1.created, 2);
    const again = await Promise.all([syncOrderCommissions(order1._id), syncOrderCommissions(order1._id)]);
    assert.strictEqual(again[0].created + again[1].created, 0);
    const lines = await AmbassadorCommission.find({ orderId: order1._id }).sort({ unitSellingPricePaise: 1 }).lean();
    assert.strictEqual(lines.length, 2);
    // coupon ₹680 split pro-rata 22999:45000 → line1 share = floor(68000×2299900/6799900) paise
    assert.strictEqual(lines[0].unitSellingPricePaise, R(22999) - Math.floor((68000 * 2299900) / 6799900));
    assert.strictEqual(lines[0].commissionPaise, TEMPLATE_SLAB_20_25K);
    assert.strictEqual(lines[0].hold, null);
    assert.strictEqual(String(lines[0].ruleId), refRuleId);
    assert.strictEqual((lines[0].ruleSnapshot as any).version, 1);
    assert.strictEqual(lines[1].commissionPaise, 0);
    assert.strictEqual(lines[1].hold?.reason, "no_rule");
    assert.strictEqual(lines[1].calc.reason, "above_slab");
  });

  await step("rule change after the fact does not alter frozen commission", async () => {
    await call("PATCH", `/admin/commission-rules/${refRuleId}`, superA, { slabs: [{ minPrice: 0, maxPrice: null, commission: 9999 }] });
    await syncOrderCommissions(order1._id);
    const l = await AmbassadorCommission.findOne({ orderId: order1._id, productId: p1._id }).lean();
    assert.strictEqual(l!.commissionPaise, TEMPLATE_SLAB_20_25K);
    // restore the slab template as v3 for later steps
    const template = (await call("GET", "/admin/commission-rules", finance)).body.template;
    await call("POST", "/admin/commission-rules", superA, template);
  });

  await step("delivery → delivery_confirmed; cancellation → reversed", async () => {
    await Order.updateOne({ _id: order1._id }, { $set: { status: "Delivered", "shipment.deliveredAt": new Date() } });
    assert.strictEqual((await syncOrderCommissions(order1._id)).delivered, 2);
    assert.strictEqual(await AmbassadorCommission.countDocuments({ orderId: order1._id, status: "delivery_confirmed" }), 2);
    await Order.updateOne({ _id: order1._id }, { $set: { status: "Cancelled" } });
    assert.strictEqual((await syncOrderCommissions(order1._id)).reversed, 2);
    assert.strictEqual((await syncOrderCommissions(order1._id)).reversed, 0, "idempotent");
  });

  await step("unpaid / failed order creates nothing", async () => {
    const ref = await resolveReferralForNewOrder(A.partnerCode, undefined, String(buyer3._id));
    const o = await mkOrder(buyer3, [{ p: p1, price: 22999 }], { paymentStatus: "Failed", status: "Pending", ambassadorRef: ref });
    assert.strictEqual((await syncOrderCommissions(o._id)).created, 0);
  });

  await step("lead-matched order → independent margin share, lead won", async () => {
    const o = await mkOrder(buyer2, [{ p: p1, price: 26000 }]);
    assert.strictEqual((await syncOrderCommissions(o._id)).created, 1);
    const c = await AmbassadorCommission.findOne({ orderId: o._id }).lean();
    assert.strictEqual(String(c!.ambassadorId), String(B._id));
    assert.strictEqual(c!.attribution.type, "lead");
    assert.strictEqual(c!.commissionPaise, R(3300));
    assert.strictEqual(c!.hold, null);
    const lead = await AmbassadorLead.findById(leadB).lean();
    assert.strictEqual(lead!.status, "won");
  });

  await step("conflict: earlier lead beats later link, held", async () => {
    await call("POST", "/partners/leads", uA, { customerName: "Kiran", phone: "9300000003", consent: true });
    await new Promise((r) => setTimeout(r, 20));
    const ref = await resolveReferralForNewOrder(B.partnerCode, new Date().toISOString(), String(buyer3._id));
    const o = await mkOrder(buyer3, [{ p: p1, price: 22999 }], { ambassadorRef: ref });
    await syncOrderCommissions(o._id);
    const c = await AmbassadorCommission.findOne({ orderId: o._id }).lean();
    assert.strictEqual(String(c!.ambassadorId), String(A._id));
    assert.strictEqual(c!.hold?.reason, "attribution_conflict");
    assert.deepStrictEqual(c!.attribution.conflictWith!.map(String), [String(B._id)]);
  });

  await step("self-referral by shipping phone, existing customer held", async () => {
    const ref = await resolveReferralForNewOrder(A.partnerCode, undefined, String(buyer4._id));
    const o = await mkOrder(buyer4, [{ p: p1, price: 22999 }], { ambassadorRef: ref, shipPhone: "+91 92000 00001" });
    await syncOrderCommissions(o._id);
    assert.strictEqual((await AmbassadorCommission.findOne({ orderId: o._id }).lean())!.hold?.reason, "self_referral");
    // buyer2 already has a paid order (lead-matched above) → existing customer for A's later link
    const ref2 = await resolveReferralForNewOrder(A.partnerCode, new Date().toISOString(), String(buyer2._id));
    const o2 = await mkOrder(buyer2, [{ p: p1, price: 22999 }], { ambassadorRef: ref2 });
    await syncOrderCommissions(o2._id);
    const c2 = await AmbassadorCommission.findOne({ orderId: o2._id }).lean();
    // B's lead for buyer2 is won and still owned → B's lead was first → conflict + existing customer, winner B
    assert.strictEqual(String(c2!.ambassadorId), String(B._id));
    assert.ok(c2!.hold);
  });

  await step("partner sees own commissions only, without internal hold reasons", async () => {
    const a = await call("GET", "/partners/commissions", uA);
    assert.ok(a.body.commissions.length >= 3);
    assert.ok(a.body.commissions.every((c: any) => !("hold" in c) && !("ruleSnapshot" in c) && !("ambassadorId" in c)));
    assert.ok(a.body.commissions.some((c: any) => c.holdNote));
    const dash = await call("GET", "/partners/dashboard", uA);
    assert.strictEqual(dash.status, 200);
    assert.strictEqual(typeof dash.body.cards.pendingCommission, "number");
  });

  await step("hold clearing: finance yes, sales no, note required", async () => {
    const held = await AmbassadorCommission.findOne({ "hold.reason": "attribution_conflict" }).lean();
    assert.strictEqual((await call("POST", `/admin/commissions/${held!._id}/clear-hold`, sales, { note: "x" })).status, 403);
    assert.strictEqual((await call("POST", `/admin/commissions/${held!._id}/clear-hold`, finance, {})).status, 400);
    assert.strictEqual((await call("POST", `/admin/commissions/${held!._id}/clear-hold`, finance, { note: "Lead predates link; verified with customer" })).status, 200);
    const after = await AmbassadorCommission.findById(held!._id).lean();
    assert.strictEqual(after!.hold, null);
    assert.strictEqual(after!.holdHistory[after!.holdHistory.length - 1].note, "Lead predates link; verified with customer");
  });

  await step("reveal sensitive: finance only, purpose required, audited", async () => {
    assert.strictEqual((await call("POST", `/admin/partners/${A._id}/reveal`, sales, { purpose: "payout" })).status, 403);
    assert.strictEqual((await call("POST", `/admin/partners/${A._id}/reveal`, finance, {})).status, 400);
    const r = await call("POST", `/admin/partners/${B._id}/reveal`, finance, { purpose: "payout verification" });
    assert.strictEqual(r.body.pan, "BBBBB2222B");
    assert.strictEqual(r.body.payout.accountNumber, "123456789012");
    assert.ok(await AuditLog.exists({ action: "ambassador.sensitive.reveal", targetId: String(B._id) }));
    const list = await call("GET", "/admin/partners", sales);
    assert.ok(!JSON.stringify(list.body).includes("v1:"), "no ciphertext in list");
  });

  await step("suspension: immediate lockout, open commissions held, no new referrals", async () => {
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/suspend`, sales, { reason: "policy review" })).status, 200);
    assert.strictEqual((await call("GET", "/partners/dashboard", uA)).status, 403);
    assert.strictEqual(await resolveReferralForNewOrder(A.partnerCode, undefined, String(buyer1._id)), undefined);
    const open = await AmbassadorCommission.find({ ambassadorId: A._id, status: { $ne: "reversed" } }).lean();
    assert.ok(open.length > 0 && open.every((c) => c.hold));
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/reactivate`, sales)).status, 403, "only super reactivates");
    assert.strictEqual((await call("PATCH", `/admin/partners/${A._id}/reactivate`, superA)).status, 200);
  });

  await step("manual attribution + override re-attribution, no duplicates", async () => {
    const o = await mkOrder(buyer1, [{ p: p1, price: 22999 }]);
    assert.strictEqual((await syncOrderCommissions(o._id)).created, 0, "no source → unattributed");
    assert.strictEqual((await call("POST", "/admin/partner-attribution", sales, { orderId: o.orderId, ambassadorId: B._id })).status, 400, "evidence required");
    const r1 = await call("POST", "/admin/partner-attribution", sales, { orderId: o.orderId, ambassadorId: B._id, evidence: "WhatsApp screenshot of referral" });
    assert.strictEqual(r1.status, 200, JSON.stringify(r1.body));
    assert.strictEqual(r1.body.created, 1);
    const r2 = await call("POST", "/admin/partner-attribution", sales, { orderId: o.orderId, ambassadorId: A._id, evidence: "correction" });
    assert.strictEqual(r2.status, 409);
    const r3 = await call("POST", "/admin/partner-attribution", sales, { orderId: String(o._id), ambassadorId: A._id, evidence: "correction", override: true });
    assert.strictEqual(r3.status, 200, JSON.stringify(r3.body));
    const all = await AmbassadorCommission.find({ orderId: o._id }).lean();
    assert.strictEqual(all.length, 2);
    assert.strictEqual(all.filter((c) => !c.superseded).length, 1);
    assert.strictEqual(String(all.find((c) => !c.superseded)!.ambassadorId), String(A._id));
    assert.ok(await AuditLog.exists({ action: "ambassador.attribution.manual", targetId: String(o._id) }));
  });

  await step("reconcile replays safely; overview + admin lead list", async () => {
    const before = await AmbassadorCommission.countDocuments();
    const r = await call("POST", "/admin/partners/reconcile", finance, { sinceDays: 7 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.created, 0);
    assert.strictEqual(r.body.errors, 0);
    assert.strictEqual(await AmbassadorCommission.countDocuments(), before);
    const ov = await call("GET", "/admin/partners/overview", sales);
    assert.strictEqual(ov.body.partners.active, 2);
    assert.ok(ov.body.commission.liability > 0);
    const leads = await call("GET", "/admin/partner-leads", sales);
    assert.ok(leads.body.total >= 2);
    assert.strictEqual((await call("GET", "/admin/partner-leads", ops)).status, 403);
  });

  await step("landing: live cohort counter, waitlist, invite → allowlist", async () => {
    const p = await call("GET", "/partners/programme");
    assert.deepStrictEqual(p.body.cohort, { size: 20, taken: 2 });
    assert.strictEqual((await call("POST", "/partners/waitlist", undefined, { fullName: "Neha", phone: "93000 00099", consent: false })).status, 400);
    const w = await call("POST", "/partners/waitlist", undefined, { fullName: "Neha S", phone: "+91 93000 00099", city: "Bengaluru", partnerType: "independent", consent: true, utmSource: "instagram" });
    assert.strictEqual(w.status, 201, JSON.stringify(w.body));
    assert.strictEqual((await call("POST", "/partners/waitlist", undefined, { fullName: "Neha S", phone: "9300000099", consent: true })).body.alreadyOnList, true);
    assert.strictEqual((await call("POST", "/partners/waitlist", undefined, { fullName: "Asha Rao", phone: "9200000001", consent: true })).status, 409, "existing partner");
    assert.strictEqual((await call("GET", "/admin/partner-waitlist", ops)).status, 403);
    const list = await call("GET", "/admin/partner-waitlist", sales);
    const entry = list.body.entries.find((e: any) => e.phone === "9300000099");
    assert.ok(entry && entry.source.utmSource === "instagram");
    assert.strictEqual((await call("POST", `/admin/partner-waitlist/${entry._id}/invite`, sales)).status, 200);
    clearSettingsCache();
    const s = await call("GET", "/admin/partner-settings", sales);
    assert.ok(s.body.settings.pilotAllowlist.includes("9300000099"));
    assert.ok(await AuditLog.exists({ action: "ambassador.waitlist.invite" }));
  });

  await step("admin lead reassign/extend audited", async () => {
    const lead = await AmbassadorLead.findOne({ ambassadorId: A._id }).lean();
    assert.strictEqual((await call("PATCH", `/admin/partner-leads/${lead!._id}`, sales, { action: "extend", days: 10 })).status, 400, "reason required");
    assert.strictEqual((await call("PATCH", `/admin/partner-leads/${lead!._id}`, sales, { action: "reassign", toAmbassadorId: B._id, reason: "partner request" })).status, 200);
    assert.ok(await AuditLog.exists({ action: "ambassador.lead.reassign" }));
  });

  // ---- Phase 2: quotations ----
  const p4 = await Product.create({ productId: "P4", title: "EliteBook 840 G6", brand: "HP", category: "Business Laptops", description: "d", price: 40000, finalPrice: 28000, stock: 3, image: "e.jpg" });
  const buyerK = await mkUser("9300000010");
  const buyerK2 = await mkUser("9300000011");
  const ssd = { storage: "512GB" }; // +₹4,000 add-on (default config options)
  const qLine = (unitPrice: number, over: any = {}) => ({ productId: String(p4._id), quantity: 1, unitPrice, config: ssd, ...over });
  const tokenOf = async (id: string) => ((await AmbassadorQuotation.findById(id).select("+token").lean()) as any).token as string;
  const cartOf = (q: any) => q.items.map((i: any) => ({ productId: String(i.productId), quantity: i.quantity, config: i.config }));
  let leadK = "";

  await step("quotation pricing preview: independent only, levels, add-on floor, stock", async () => {
    assert.strictEqual((await call("POST", "/partners/quotations/price", uA, { items: [qLine(26000)] })).status, 403, "referral partners can't quote");
    const pv = await call("POST", "/partners/quotations/price", uB, { items: [qLine(26000)] });
    assert.strictEqual(pv.status, 200, JSON.stringify(pv.body));
    const l = pv.body.items[0];
    assert.strictEqual(l.listedUnitPrice, 32000);
    assert.strictEqual(l.floorUnitPrice, 24000); // ₹20,000 floor + ₹4,000 SSD at face value
    assert.strictEqual(l.level, 2);
    assert.strictEqual(l.estCommissionPerUnit, 1300); // 300 + 50% × (26,000 − 24,000)
    assert.strictEqual((await call("POST", "/partners/quotations/price", uB, { items: [qLine(32001)] })).body.errors["items.0"], "A quotation can't be above the listed price");
    assert.strictEqual((await call("POST", "/partners/quotations/price", uB, { items: [qLine(26000, { quantity: 4 })] })).body.errors["items.0"], "Only 3 in stock");
    assert.strictEqual((await call("POST", "/partners/quotations/price", uB, { items: [qLine(26000, { config: { ram: "64GB" } })] })).status, 400, "unknown option");
  });

  let q1: any;
  await step("create quotation: lead auto-created, ownership enforced, public link hides internals", async () => {
    const body = { customer: { name: "Kiran M", phone: "93000 00010", location: "Whitefield" }, items: [qLine(26000)], customerNote: "Price as discussed on call" };
    assert.strictEqual((await call("POST", "/partners/quotations", uB, body)).status, 400, "consent needed for a new customer");
    const r = await call("POST", "/partners/quotations", uB, { ...body, consent: true });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    q1 = r.body.quotation;
    assert.match(q1.quoteNumber, /^LSQ-\d{6}$/);
    assert.strictEqual(q1.status, "active");
    assert.ok(q1.shareUrl.startsWith("https://lapshark.com/quote/"));
    assert.ok(Math.abs(new Date(q1.validUntil).getTime() - Date.now() - 24 * 3600000) < 60000, "24 h validity");
    const lead = await AmbassadorLead.findOne({ phone: "9300000010" }).lean();
    assert.ok(lead && String(lead.ambassadorId) === String(B._id) && lead.status === "quotation_sent");
    leadK = String(lead!._id);
    assert.strictEqual((await call("POST", "/partners/leads", uA, { customerName: "Kiran", phone: "9300000010", consent: true })).status, 409, "B owns this customer now");
    const tok = q1.shareUrl.split("/quote/")[1];
    const pub = await call("GET", `/quotes/${tok}`);
    assert.strictEqual(pub.status, 200);
    assert.strictEqual(pub.body.quotation.totals.total, 26000);
    assert.strictEqual(pub.body.quotation.preparedBy.partnerCode, B.partnerCode);
    const txt = JSON.stringify(pub.body);
    for (const k of ["floor", "ommission", "level", "9300000010", "rule"]) assert.ok(!txt.includes(k), `public view leaks ${k}`);
    assert.strictEqual((await call("GET", "/quotes/not-a-token")).status, 404);
  });

  let q2: any;
  await step("Level 3: below floor needs a reason, approval sets commission, audited", async () => {
    assert.ok((await call("POST", "/partners/quotations", uB, { leadId: leadK, items: [qLine(22000)] })).body.errors?.discountReason);
    const r = await call("POST", "/partners/quotations", uB, { leadId: leadK, items: [qLine(22000)], discountReason: "Customer has a competing quote at 22k" });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    q2 = r.body.quotation;
    assert.strictEqual(q2.status, "pending_approval");
    assert.strictEqual(q2.shareUrl, null);
    assert.strictEqual(q2.items[0].level, 3);
    const lock = await loadQuoteForCheckout(await tokenOf(q2._id), cartOf(q2));
    assert.ok(!lock.ok && lock.status === 409);
    assert.strictEqual((await call("GET", "/admin/discount-requests", ops)).status, 403);
    assert.strictEqual((await call("GET", "/admin/discount-requests", finance)).status, 403);
    const list = await call("GET", "/admin/discount-requests", sales);
    const dr = list.body.requests.find((d: any) => String(d.quotationId) === String(q2._id));
    assert.ok(dr && dr.lines[0].belowFloorBy === 2000 && dr.lines[0].ruleCommissionPerUnit === 0, JSON.stringify(dr));
    const body150 = { lines: [{ itemId: dr.lines[0].itemId, commissionPerUnit: 150 }], note: "match competitor once" };
    assert.strictEqual((await call("POST", `/admin/discount-requests/${dr._id}/approve`, sales, body150)).status, 403, "super admin only (D16)");
    assert.strictEqual((await call("POST", `/admin/discount-requests/${dr._id}/reject`, sales, { reason: "x" })).status, 403, "super admin only (D16)");
    assert.strictEqual((await call("POST", `/admin/discount-requests/${dr._id}/approve`, superA, { lines: [] })).status, 400, "commission required");
    const ok = await call("POST", `/admin/discount-requests/${dr._id}/approve`, superA, body150);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await call("POST", `/admin/discount-requests/${dr._id}/approve`, superA, body150)).status, 409);
    const d = await call("GET", `/partners/quotations/${q2._id}`, uB);
    assert.strictEqual(d.body.quotation.status, "active");
    assert.strictEqual(d.body.quotation.totals.estCommission, 150);
    assert.ok(d.body.quotation.shareUrl);
    assert.strictEqual(d.body.discountRequest.status, "approved");
    assert.ok(await AuditLog.exists({ action: "ambassador.discount.approve" }));
  });

  await step("revise / expire / cancel / reject", async () => {
    const r = await call("POST", "/partners/quotations", uB, { leadId: leadK, items: [qLine(32000)] });
    assert.strictEqual(r.body.quotation.items[0].level, 1);
    const oldTok = await tokenOf(r.body.quotation._id);
    const v2 = await call("POST", `/partners/quotations/${r.body.quotation._id}/revise`, uB, { items: [qLine(30000)] });
    assert.strictEqual(v2.status, 201, JSON.stringify(v2.body));
    assert.strictEqual(v2.body.quotation.version, 2);
    assert.strictEqual(v2.body.quotation.quoteNumber, r.body.quotation.quoteNumber);
    const dead = await loadQuoteForCheckout(oldTok, cartOf(r.body.quotation));
    assert.ok(!dead.ok && /updated/.test(dead.message));
    assert.strictEqual((await call("POST", `/partners/quotations/${r.body.quotation._id}/revise`, uB, { items: [qLine(29000)] })).status, 409, "superseded can't be revised");
    const det = await call("GET", `/partners/quotations/${v2.body.quotation._id}`, uB);
    assert.deepStrictEqual(det.body.versions.map((v: any) => [v.version, v.status]), [[2, "active"], [1, "superseded"]]);
    await AmbassadorQuotation.updateOne({ _id: v2.body.quotation._id }, { $set: { validUntil: new Date(Date.now() - 1000) } });
    const exp = await call("GET", "/partners/quotations?status=expired", uB);
    assert.ok(exp.body.quotations.some((q: any) => q._id === v2.body.quotation._id && q.status === "expired" && q.shareUrl === null));
    const expLock = await loadQuoteForCheckout(await tokenOf(v2.body.quotation._id), cartOf(v2.body.quotation));
    assert.ok(!expLock.ok && /expired/.test(expLock.message));
    assert.strictEqual((await call("POST", `/partners/quotations/${v2.body.quotation._id}/cancel`, uB)).status, 200);
    assert.strictEqual((await call("POST", `/partners/quotations/${v2.body.quotation._id}/cancel`, uB)).status, 409);
    const l3 = await call("POST", "/partners/quotations", uB, { leadId: leadK, items: [qLine(21000)], discountReason: "Bulk order for a startup" });
    const dr = (await call("GET", "/admin/discount-requests", superA)).body.requests.find((d: any) => String(d.quotationId) === String(l3.body.quotation._id));
    assert.strictEqual((await call("POST", `/admin/discount-requests/${dr._id}/reject`, superA, {})).status, 400, "reason required");
    assert.strictEqual((await call("POST", `/admin/discount-requests/${dr._id}/reject`, superA, { reason: "Too far below cost" })).status, 200);
    assert.strictEqual((await call("GET", `/partners/quotations/${l3.body.quotation._id}`, uB)).body.discountRequest.decisionNote, "Too far below cost");
    assert.strictEqual((await call("POST", `/partners/quotations/${l3.body.quotation._id}/revise`, uB, { items: [qLine(25000)] })).status, 201, "rejected can be revised");
    assert.strictEqual((await call("GET", "/admin/partner-quotations", finance)).status, 200);
    assert.strictEqual((await call("GET", "/admin/partner-quotations", ops)).status, 403);
  });

  await step("checkout lock: cart must match; paid orders use approved and add-on-aware commission", async () => {
    const t2 = await tokenOf(q2._id);
    const bad = await loadQuoteForCheckout(t2, [{ productId: String(p4._id), quantity: 2, config: ssd }]);
    assert.ok(!bad.ok && /doesn't match/.test(bad.message));
    const lock = await loadQuoteForCheckout(t2, cartOf(q2));
    assert.ok(lock.ok);
    const q2doc: any = (lock as any).quote;
    // The order exactly as createOrder builds it from a quotation.
    const o = await mkOrder(buyerK, [{ p: p4, price: 22000, extra: { configCost: 4000, quoteItemId: q2doc.items[0]._id } }], {
      ambassadorRef: { code: B.partnerCode, ambassadorId: B._id, capturedAt: q2doc.createdAt },
      ambassadorQuote: { quotationId: q2doc._id, quoteNumber: q2doc.quoteNumber, version: q2doc.version },
    });
    assert.strictEqual((await syncOrderCommissions(o._id)).created, 1);
    const c = await AmbassadorCommission.findOne({ orderId: o._id }).lean();
    assert.strictEqual(String(c!.ambassadorId), String(B._id));
    assert.strictEqual(c!.commissionPaise, R(150));
    assert.strictEqual(c!.calc.reason, "special_approval");
    assert.strictEqual(c!.hold, null);
    const conv = await AmbassadorQuotation.findById(q2._id).lean();
    assert.strictEqual(conv!.status, "converted");
    assert.strictEqual(conv!.convertedOrderNumber, o.orderId);
    const again = await loadQuoteForCheckout(t2, cartOf(q2));
    assert.ok(!again.ok && /already been used/.test(again.message));
    assert.strictEqual((await AmbassadorLead.findById(leadK).lean())!.status, "won");

    const t1 = await tokenOf(q1._id);
    const lock1: any = await loadQuoteForCheckout(t1, cartOf(q1));
    assert.ok(lock1.ok, JSON.stringify(lock1));
    const o2 = await mkOrder(buyerK2, [{ p: p4, price: 26000, extra: { configCost: 4000, quoteItemId: lock1.quote.items[0]._id } }], {
      ambassadorRef: { code: B.partnerCode, ambassadorId: B._id, capturedAt: lock1.quote.createdAt },
      ambassadorQuote: { quotationId: lock1.quote._id, quoteNumber: lock1.quote.quoteNumber, version: 1 },
    });
    await syncOrderCommissions(o2._id);
    const c2 = await AmbassadorCommission.findOne({ orderId: o2._id }).lean();
    assert.strictEqual(c2!.commissionPaise, R(1300), "margin share excludes the ₹4,000 SSD");
    assert.strictEqual(c2!.calc.reason, "margin_share");
    assert.strictEqual((await call("POST", "/partners/quotations", uB, { leadId: leadK, items: [qLine(32000)] })).status, 409, "won lead closed");
  });

  await step("createOrder: quotation price lock end to end (Razorpay stubbed)", async () => {
    const q = await call("POST", "/partners/quotations", uB, { customer: { name: "Ravi T", phone: "9300000012" }, consent: true, items: [qLine(26000)] });
    assert.strictEqual(q.status, 201, JSON.stringify(q.body));
    const quotationToken = q.body.quotation.shareUrl.split("/quote/")[1];
    const base = {
      customerName: "Ravi T",
      paymentMethod: "Razorpay",
      shippingAddress: { street: "1 Main", city: "Bengaluru", state: "KA", zip: "560001", phone: "9300000012", type: "Home" },
      items: [{ productId: String(p4._id), quantity: 1, config: ssd, expectedFinalPrice: 26000 }],
    };
    assert.strictEqual((await call("POST", "/orders/create", undefined, { ...base, quotationToken, coupon: "SAVE10" })).status, 400, "no coupon on a quotation");
    assert.strictEqual((await call("POST", "/orders/create", undefined, { ...base, quotationToken, items: [{ ...base.items[0], quantity: 2 }] })).status, 409, "cart must match");
    assert.strictEqual((await call("POST", "/orders/create", undefined, { ...base, quotationToken: "x".repeat(32) })).status, 404);
    const r = await call("POST", "/orders/create", undefined, { ...base, quotationToken });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const o: any = await Order.findById(r.body.order._id).lean();
    assert.strictEqual(o.total, 26000, "quoted price, free shipping above ₹10,000");
    assert.strictEqual(r.body.amount, 2600000);
    assert.strictEqual(o.items[0].finalPrice, 26000);
    assert.strictEqual(o.items[0].configCost, 4000);
    assert.strictEqual(o.items[0].originalPrice, 32000);
    assert.strictEqual(o.items[0].extraOfferLabel, `Partner quotation ${q.body.quotation.quoteNumber}`);
    assert.strictEqual(String(o.items[0].quoteItemId), String(q.body.quotation.items[0]._id));
    assert.strictEqual(String(o.ambassadorRef.ambassadorId), String(B._id));
    assert.strictEqual(o.ambassadorQuote.quoteNumber, q.body.quotation.quoteNumber);
    assert.strictEqual(o.paymentStatus, "Pending");
    assert.strictEqual((await syncOrderCommissions(o._id)).created, 0, "nothing until paid");
    assert.strictEqual((await AmbassadorQuotation.findById(q.body.quotation._id).lean())!.status, "active", "unpaid order doesn't consume the quotation");

    // A normal order is unchanged apart from recording the add-on cost.
    const plain = await call("POST", "/orders/create", undefined, { ...base, items: [{ productId: String(p1._id), quantity: 1, config: ssd, expectedFinalPrice: 26999 }] });
    assert.strictEqual(plain.status, 200, JSON.stringify(plain.body));
    const po: any = await Order.findById(plain.body.order._id).lean();
    assert.strictEqual(po.items[0].finalPrice, 26999);
    assert.strictEqual(po.items[0].configCost, 4000);
    assert.strictEqual(po.ambassadorQuote, undefined);
    assert.strictEqual(po.items[0].quoteItemId, undefined);
  });

  await step("laptop minimums: per-laptop minimum overrides the default, versioned", async () => {
    assert.strictEqual((await call("GET", "/admin/laptop-minimums", ops)).status, 403);
    const before = await call("GET", "/admin/laptop-minimums", finance);
    assert.strictEqual(before.status, 200);
    assert.strictEqual(before.body.defaultRule.minimumPrice, 20000);
    const row = before.body.laptops.find((l: any) => String(l._id) === String(p4._id));
    assert.ok(row && row.rule === null && row.listedPrice === 28000, JSON.stringify(row));
    assert.ok(!before.body.laptops.some((l: any) => l.stock === 0), "in-stock only");
    const set = await call("POST", "/admin/commission-rules", superA, { partnerType: "independent", kind: "margin_share", productId: String(p4._id), minimumPrice: 25000, baseCommission: 400, marginSharePercent: 40 });
    assert.strictEqual(set.status, 201, JSON.stringify(set.body));
    const after = await call("GET", "/admin/laptop-minimums", sales);
    const row2 = after.body.laptops.find((l: any) => String(l._id) === String(p4._id));
    assert.deepStrictEqual([row2.rule.minimumPrice, row2.rule.baseCommission, row2.rule.marginSharePercent, row2.rule.version], [25000, 400, 40, 1]);
    // the quotation engine now uses the laptop's own minimum
    const pv = await call("POST", "/partners/quotations/price", uB, { items: [qLine(26000, { config: {} })] });
    assert.strictEqual(pv.body.items[0].floorUnitPrice, 25000);
    assert.strictEqual(pv.body.items[0].estCommissionPerUnit, 800); // 400 + 40% × 1,000
    const v2 = await call("POST", "/admin/commission-rules", superA, { partnerType: "independent", kind: "margin_share", productId: String(p4._id), minimumPrice: 24000, baseCommission: 400, marginSharePercent: 40 });
    assert.strictEqual(v2.body.rule.version, 2);
    assert.strictEqual(v2.body.retired.version, 1);
  });

  // ---- Phase 3: eligibility, approval, payouts, clawbacks ----
  const DAY = 86400000;
  const pb1 = await mkUser("9300000020");
  const pb2 = await mkUser("9300000021");
  const pb3 = await mkUser("9300000022");
  const refB = () => ({ code: B.partnerCode, ambassadorId: B._id, capturedAt: new Date(Date.now() - 30 * DAY) });
  const delivered = (daysAgo: number) => ({ status: "Delivered", shipment: { deliveredAt: new Date(Date.now() - daysAgo * DAY) } });
  let D1: any, D2: any, D3: any;
  const lineOf = async (o: any) => (await AmbassadorCommission.findOne({ orderId: o._id, superseded: false }).lean())!;
  const payoutKey = () => "test-" + crypto.randomBytes(12).toString("hex");
  const callKey = async (user: any, key: string | null, body: any = {}) => {
    const r = await fetch(base + "/admin/payouts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok(user)}`, ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };

  await step("eligibility: delivered + paid + 14-day hold; COD balance; job is finance-only", async () => {
    D1 = await mkOrder(pb1, [{ p: p1, price: 22000 }], { ambassadorRef: refB(), ...delivered(20) }); // 300 + 50% × 2,000 = 1,300
    D2 = await mkOrder(pb2, [{ p: p1, price: 26000 }], { ambassadorRef: refB(), ...delivered(3) }); // 3,300
    D3 = await mkOrder(pb3, [{ p: p1, price: 24000 }], { ambassadorRef: refB(), ...delivered(20), paymentMethod: "COD", advanceAmount: 500 }); // 2,300
    for (const o of [D1, D2, D3]) await syncOrderCommissions(o._id);
    for (const o of [D1, D2, D3]) assert.strictEqual((await lineOf(o)).status, "delivery_confirmed");
    assert.strictEqual((await call("POST", "/admin/commissions/run-eligibility", sales)).status, 403);
    const r = await call("POST", "/admin/commissions/run-eligibility", finance);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await lineOf(D1)).status, "eligible");
    assert.strictEqual((await lineOf(D2)).status, "delivery_confirmed", "still inside the return window");
    assert.strictEqual((await lineOf(D3)).status, "delivery_confirmed", "COD balance not collected");
    assert.ok(r.body.waiting.hold_period >= 1 && r.body.waiting.cod_not_collected >= 1, JSON.stringify(r.body));
    assert.strictEqual((await call("POST", "/admin/commissions/run-eligibility", finance)).body.madeEligible, 0, "idempotent");
  });

  let pay1: any;
  await step("approval (finance only) and an idempotent payout batch", async () => {
    const l1 = await lineOf(D1);
    const l2 = await lineOf(D2);
    assert.strictEqual((await call("POST", "/admin/commissions/approve", sales, { ids: [l1._id] })).status, 403);
    const ap = await call("POST", "/admin/commissions/approve", finance, { ids: [l1._id, l2._id] });
    assert.deepStrictEqual(ap.body, { approved: 1, skipped: 1 }, "only eligible lines");
    const ready = await call("GET", "/admin/payouts/ready", finance);
    const rowB = ready.body.partners.find((x: any) => String(x.ambassadorId) === String(B._id));
    assert.ok(rowB && rowB.payable && rowB.totals.net === 1300, JSON.stringify(rowB));
    assert.strictEqual((await callKey(finance, null)).status, 400, "Idempotency-Key required");
    assert.strictEqual((await callKey(sales, payoutKey())).status, 403);
    const key = payoutKey();
    const [a, b] = await Promise.all([callKey(finance, key), callKey(finance, key)]);
    const first = await callKey(finance, key);
    assert.ok([a.status, b.status].includes(201) || [a.status, b.status].every((x) => x === 200), `${a.status}/${b.status}`);
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.replay, true);
    assert.strictEqual(await AmbassadorPayout.countDocuments({ batchKey: key }), 1, "same key never pays twice");
    pay1 = first.body.payouts[0];
    assert.strictEqual(pay1.net, 1300);
    assert.match(pay1.payoutNumber, /^LSP-\d{6}$/);
    assert.strictEqual((await lineOf(D1)).status, "processing");
    assert.strictEqual((await callKey(finance, payoutKey())).body.payouts.length, 0, "nothing left to pay");
  });

  await step("mark paid: reference required, immutable, partner sees it", async () => {
    assert.strictEqual((await call("POST", `/admin/payouts/${pay1._id}/mark-paid`, finance, { reference: "x" })).status, 400);
    const ok = await call("POST", `/admin/payouts/${pay1._id}/mark-paid`, finance, { reference: "UTR 123456789012" });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const l1 = await lineOf(D1);
    assert.strictEqual(l1.status, "paid");
    assert.ok((l1 as any).paidAt);
    assert.strictEqual((await call("POST", `/admin/payouts/${pay1._id}/mark-paid`, finance, { reference: "UTR 123456789012" })).body.alreadyPaid, true);
    assert.strictEqual((await call("POST", `/admin/payouts/${pay1._id}/mark-paid`, finance, { reference: "UTR 999" + "999999" })).status, 409, "can't change a paid payout");
    assert.strictEqual((await call("POST", `/admin/payouts/${pay1._id}/fail`, finance, { reason: "x" })).status, 409);
    assert.strictEqual((await call("POST", `/admin/commissions/${l1._id}/reverse`, finance, { reason: "x" })).status, 409, "paid line can't be reversed in place");
    const mine = await call("GET", "/partners/payouts", uB);
    assert.strictEqual(mine.body.payouts[0].reference, "UTR 123456789012");
    assert.ok(!("batchKey" in mine.body.payouts[0]));
    assert.ok(await AuditLog.exists({ action: "ambassador.payout.paid" }));
  });

  await step("refund after payout → one clawback; paid line untouched", async () => {
    await Order.updateOne({ _id: D1._id }, { $set: { paymentStatus: "Refunded" } });
    await syncOrderCommissions(D1._id);
    await syncOrderCommissions(D1._id);
    const adj = await AmbassadorAdjustment.find({ kind: "clawback", orderNumber: D1.orderId }).lean();
    assert.strictEqual(adj.length, 1, "exactly one clawback");
    assert.strictEqual(adj[0].amountPaise, -R(1300));
    assert.strictEqual((await lineOf(D1)).status, "paid", "paid record not edited");
    assert.strictEqual((await call("GET", "/partners/payouts", uB)).body.summary.openAdjustments, -1300);
  });

  await step("next payout nets the clawback with TDS; failed transfer returns lines; retry pays", async () => {
    await AmbassadorCommission.updateOne({ orderId: D2._id }, { $set: { deliveredAt: new Date(Date.now() - 20 * DAY) } });
    await Order.updateOne({ _id: D2._id }, { $set: { "shipment.deliveredAt": new Date(Date.now() - 20 * DAY) } });
    await call("POST", "/admin/commissions/run-eligibility", finance);
    assert.strictEqual((await call("POST", "/admin/commissions/approve", finance, { ids: [(await lineOf(D2))._id] })).body.approved, 1);
    assert.strictEqual((await call("PUT", "/admin/partner-settings", superA, { tdsPercent: 10 })).status, 200);
    clearSettingsCache();
    const p2 = (await callKey(finance, payoutKey())).body.payouts[0];
    assert.deepStrictEqual([p2.gross, p2.adjustments, p2.tds, p2.net], [3300, -1300, 200, 1800]);
    assert.strictEqual((await call("POST", `/admin/payouts/${p2._id}/fail`, finance, {})).status, 400, "reason required");
    assert.strictEqual((await call("POST", `/admin/payouts/${p2._id}/fail`, finance, { reason: "UPI id inactive" })).status, 200);
    assert.strictEqual((await lineOf(D2)).status, "approved");
    assert.strictEqual((await AmbassadorAdjustment.findOne({ orderNumber: D1.orderId }).lean())!.status, "open");
    const p3 = (await callKey(finance, payoutKey())).body.payouts[0];
    assert.strictEqual(p3.net, 1800);
    assert.notStrictEqual(p3._id, p2._id);
    assert.strictEqual((await call("POST", `/admin/payouts/${p3._id}/mark-paid`, finance, { reference: "UTR-555000111" })).status, 200);
    assert.strictEqual((await AmbassadorAdjustment.findOne({ orderNumber: D1.orderId }).lean())!.status, "settled");
    assert.strictEqual((await call("PUT", "/admin/partner-settings", superA, { tdsPercent: 0 })).status, 200);
    clearSettingsCache();
  });

  await step("order reversed while its payout is in flight, then the transfer fails → line reversed, clawback void", async () => {
    await Order.updateOne({ _id: D3._id }, { $set: { codCollected: { at: new Date() } } });
    await call("POST", "/admin/commissions/run-eligibility", finance);
    assert.strictEqual((await call("POST", "/admin/commissions/approve", finance, { ids: [(await lineOf(D3))._id] })).body.approved, 1);
    const p4 = (await callKey(finance, payoutKey())).body.payouts[0];
    assert.strictEqual(p4.net, 2300);
    await Order.updateOne({ _id: D3._id }, { $set: { paymentStatus: "Refunded" } });
    await syncOrderCommissions(D3._id);
    assert.strictEqual((await AmbassadorAdjustment.findOne({ orderNumber: D3.orderId }).lean())!.status, "open");
    const f = await call("POST", `/admin/payouts/${p4._id}/fail`, finance, { reason: "bank rejected" });
    assert.strictEqual(f.body.reversedLines, 1);
    assert.strictEqual((await lineOf(D3)).status, "reversed");
    assert.strictEqual((await AmbassadorAdjustment.findOne({ orderNumber: D3.orderId }).lean())!.status, "void");
    assert.strictEqual((await call("GET", "/admin/payouts/ready", finance)).body.partners.filter((x: any) => String(x.ambassadorId) === String(B._id) && x.payable).length, 0, "nothing double-counted");
  });

  await step("manual adjustments, void, reconciliation balances", async () => {
    assert.strictEqual((await call("POST", "/admin/partner-adjustments", finance, { ambassadorId: B._id, amount: 0, reason: "nothing" })).status, 400);
    const adj = await call("POST", "/admin/partner-adjustments", finance, { ambassadorId: B._id, amount: 250.5, reason: "Courier delay goodwill" });
    assert.strictEqual(adj.status, 201, JSON.stringify(adj.body));
    assert.strictEqual((await call("POST", `/admin/partner-adjustments/${adj.body.adjustment._id}/void`, finance, {})).status, 400);
    assert.strictEqual((await call("POST", `/admin/partner-adjustments/${adj.body.adjustment._id}/void`, finance, { reason: "entered twice" })).status, 200);
    assert.strictEqual((await call("POST", `/admin/partner-adjustments/${adj.body.adjustment._id}/void`, finance, { reason: "again" })).status, 409);
    const rec = await call("GET", "/admin/payouts/reconciliation", finance);
    assert.strictEqual(rec.status, 200);
    assert.strictEqual(rec.body.totals.inconsistent, 0, JSON.stringify(rec.body.rows.filter((r: any) => !r.consistent)));
    assert.strictEqual(rec.body.totals.paid.count, 2);
    assert.strictEqual(rec.body.totals.paid.net, 1300 + 1800);
    assert.strictEqual(rec.body.totals.failed.count, 2);
    assert.strictEqual((await call("GET", "/admin/payouts/reconciliation", sales)).status, 403);
    assert.ok(await AuditLog.exists({ action: "ambassador.adjustment.void" }));
  });

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(`ambassador integration: ${passed} steps passed`);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
