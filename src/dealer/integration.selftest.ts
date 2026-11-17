// End-to-end check of the dealer channel against a REAL MongoDB, but only a
// throwaway local one. Never reads MONGO_URI (that is production).
//
//   DEALER_TEST_MONGO_URI="mongodb://localhost:27099/lapshark_dealer_test?replicaSet=rs0&directConnection=true" \
//     npx ts-node src/dealer/integration.selftest.ts
import assert from "assert";
import crypto from "crypto";
import type { AddressInfo } from "net";

const URI = process.env.DEALER_TEST_MONGO_URI || "";
{
  const u = new URL(URI || "mongodb://invalid");
  const db = u.pathname.replace(/^\//, "");
  if (!URI || !["localhost", "127.0.0.1"].includes(u.hostname) || !db.endsWith("_test")) {
    console.error("Refusing to run: DEALER_TEST_MONGO_URI must point at localhost and a database ending in _test.");
    process.exit(2);
  }
}
process.env.JWT_SECRET = "dealer-test-secret-" + crypto.randomBytes(8).toString("hex");
process.env.AMBASSADOR_ENC_KEY = crypto.randomBytes(32).toString("base64");
process.env.AMBASSADOR_HASH_KEY = crypto.randomBytes(32).toString("base64");

async function main() {
  const mongoose = (await import("mongoose")).default;
  const express = (await import("express")).default;
  const jwt = (await import("jsonwebtoken")).default;
  const User = (await import("../models/User")).default;
  const Product = (await import("../models/Product")).default;
  const Order = (await import("../models/Order")).default;
  const AuditLog = (await import("../models/AuditLog")).default;
  const AmbassadorCommission = (await import("../ambassador/models/AmbassadorCommission")).default;
  const DealerProfile = (await import("./models/DealerProfile")).default;
  const DealerOrder = (await import("./models/DealerOrder")).default;
  const DealerUnit = (await import("./models/DealerUnit")).default;
  const routes = (await import("./routes")).default;
  const { clearDealerSettingsCache } = await import("./services/settings");

  await mongoose.connect(URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m: any) => m.syncIndexes()));

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api", routes);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  let passed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      clearDealerSettingsCache();
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
  const R = (rupees: number) => rupees * 100;

  const superA = await mkUser("9100000001", "admin");
  const sales = await mkUser("9100000002", "admin", "sales_admin");
  const ops = await mkUser("9100000003", "admin", "operations");
  const finance = await mkUser("9100000004", "admin", "finance");
  const u1 = await mkUser("9400000001");
  const u2 = await mkUser("9400000002");
  const u3 = await mkUser("9400000003");
  const customer = await mkUser("9400000009");

  const mk = (productId: string, title: string, stock: number, finalPrice = 25000) =>
    Product.create({ productId, title, brand: "Dell", category: "Business Laptops", description: "d", price: finalPrice + 5000, finalPrice, stock, image: `${productId}.jpg` });
  const p1 = await mk("P1", "Latitude 5410", 5);
  const p2 = await mk("P2", "ProBook 440", 1);
  const p3 = await mk("P3", "No dealer price", 4);
  const p4 = await mk("P4", "Last unit", 1);
  const p5 = await mk("P5", "Workstation", 3, 200000);
  const p6 = await mk("P6", "Mid laptop", 3, 70000);

  // Retail order already holding a serial.
  await mongoose.connection.collection("orders").insertOne({ orderId: "LS-TEST-1", status: "Delivered", items: [{ title: "Retail laptop", serialNumber: "retail123" }], createdAt: new Date() });
  // An ambassador profile for u3 (only the fields the overlap flag reads).
  await mongoose.connection.collection("ambassadorprofiles").insertOne({ userId: u3._id, partnerCode: "LSA-000777", status: "active" });

  const addr = { line1: "12 SP Road", city: "Bengaluru", state: "Karnataka", pincode: "560002" };
  const reg = (over: any = {}) => ({ businessName: "Laptop Point", contactName: "Ravi", gstin: "29ABCDE1234F1Z5", address: addr, agreementVersion: "2026-11-dealer-draft", noWarrantyAcknowledged: true, ...over });
  let D1: any, D2: any, O1: any;

  console.log("dealer integration:");

  await step("disabled by default: register and catalogue 503, programme readable", async () => {
    const prog = await call("GET", "/dealers/programme");
    assert.strictEqual(prog.status, 200);
    assert.strictEqual(prog.body.enabled, false);
    assert.strictEqual(prog.body.claimWindowDays, 7);
    assert.strictEqual((await call("POST", "/dealers/register", u1, reg())).status, 503);
    assert.strictEqual((await call("GET", "/dealers/catalogue", u1)).status, 503);
  });

  await step("only super admin changes settings; cash cap can't exceed Rs 2,00,000", async () => {
    assert.strictEqual((await call("PUT", "/admin/dealer-settings", sales, { enabled: true })).status, 403);
    assert.strictEqual((await call("PUT", "/admin/dealer-settings", superA, { cashLimitPaise: R(300000) })).status, 400);
    const r = await call("PUT", "/admin/dealer-settings", superA, { enabled: true, registrationOpen: true, bankTransferInstructions: "Test bank details" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.settings.cashLimitPaise, R(200000));
  });

  await step("registration: GSTIN encrypted and masked, duplicates refused, ambassador overlap flagged", async () => {
    const r1 = await call("POST", "/dealers/register", u1, reg());
    assert.strictEqual(r1.status, 201, JSON.stringify(r1.body));
    assert.strictEqual(r1.body.profile.dealerCode, "DLR-0001");
    assert.strictEqual(r1.body.profile.gstinMasked, "XXXXXXXXXXXF1Z5");
    assert.ok(!JSON.stringify(r1.body).includes("29ABCDE1234F1Z5"));
    D1 = r1.body.profile;
    const raw: any = await DealerProfile.findById(D1.id).lean();
    assert.ok(raw.gstin.encrypted.startsWith("v1:") && !raw.gstin.encrypted.includes("ABCDE"));
    assert.strictEqual((await call("POST", "/dealers/register", u2, reg())).status, 409); // same GSTIN
    assert.strictEqual((await call("POST", "/dealers/register", u1, reg({ gstin: "29AAAAA1111A1Z5" }))).status, 409); // already applied
    assert.strictEqual((await call("POST", "/dealers/register", u2, reg({ gstin: "", pan: "" }))).status, 400);
    const r2 = await call("POST", "/dealers/register", u2, reg({ businessName: "PC Hub", gstin: "", pan: "ABCPD1234Q" }));
    assert.strictEqual(r2.status, 201);
    D2 = r2.body.profile;
    const r3 = await call("POST", "/dealers/register", u3, reg({ businessName: "Amb Shop", gstin: "", pan: "ABCPE1234R" }));
    assert.strictEqual(r3.status, 201);
    const p3raw: any = await DealerProfile.findById(r3.body.profile.id).lean();
    assert.strictEqual(p3raw.flags[0].type, "also_ambassador");
  });

  await step("unapproved dealer and plain customer can't see the catalogue", async () => {
    const r = await call("GET", "/dealers/catalogue", u1);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.code, "DEALER_NOT_APPROVED");
    assert.strictEqual((await call("GET", "/dealers/catalogue", customer)).status, 404);
  });

  await step("approval by sales admin; finance can't approve; reveal is finance/super only and audited", async () => {
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D1.id}/approve`, finance)).status, 403);
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D1.id}/approve`, sales)).status, 200);
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D2.id}/approve`, sales)).status, 200);
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D1.id}/reject`, sales, { reason: "x" })).status, 409); // approved can't be rejected
    assert.strictEqual((await call("POST", `/admin/dealers/${D1.id}/reveal`, sales)).status, 403);
    const rev = await call("POST", `/admin/dealers/${D1.id}/reveal`, finance);
    assert.strictEqual(rev.body.gstin, "29ABCDE1234F1Z5");
    assert.ok(await AuditLog.exists({ action: "dealer.reveal" }));
  });

  await step("prices: only super admin sets them; validation", async () => {
    assert.strictEqual((await call("PUT", `/admin/dealer-prices/${p1._id}`, sales, { pricePaise: R(18000) })).status, 403);
    assert.strictEqual((await call("PUT", `/admin/dealer-prices/${p1._id}`, superA, { pricePaise: 1800.5 })).status, 400);
    assert.strictEqual((await call("PUT", `/admin/dealer-prices/${p1._id}`, superA, { pricePaise: R(18000), warranty: { months: 6, pricePaise: R(1000) } })).status, 200);
    for (const [p, price] of [[p2, 15000], [p4, 12000], [p5, 150000], [p6, 60000]] as const) {
      assert.strictEqual((await call("PUT", `/admin/dealer-prices/${p._id}`, superA, { pricePaise: R(price) })).status, 200);
    }
    const list = await call("GET", "/admin/dealer-prices", finance);
    assert.strictEqual(list.body.products.find((x: any) => x.productId === String(p3._id)).dealerPrice, null);
  });

  await step("catalogue: priced, in-stock laptops only", async () => {
    const r = await call("GET", "/dealers/catalogue", u1);
    assert.strictEqual(r.status, 200);
    const ids = r.body.products.map((x: any) => x.productId);
    assert.ok(ids.includes(String(p1._id)) && !ids.includes(String(p3._id)));
    const e1 = r.body.products.find((x: any) => x.productId === String(p1._id));
    assert.strictEqual(e1.pricePaise, R(18000));
    assert.deepStrictEqual(e1.warranty, { months: 6, pricePaise: R(1000) });
    assert.strictEqual(e1.listedPricePaise, R(25000));
  });

  await step("order: server prices it, ignores client prices, reserves stock; no MOQ", async () => {
    const r = await call("POST", "/dealers/orders", u1, {
      items: [{ productId: String(p1._id), quantity: 2, withWarranty: true, unitPricePaise: 1 }, { productId: String(p2._id), quantity: 1 }],
      paymentMethod: "bank_transfer",
      fulfilment: { method: "courier", address: addr },
      totalPaise: 1,
    });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    O1 = r.body.order;
    assert.strictEqual(O1.orderNumber, "LSD-000001");
    assert.strictEqual(O1.totalPaise, R(19000 * 2 + 15000));
    assert.strictEqual(O1.status, "placed");
    assert.strictEqual(r.body.payment.bankTransfer, "Test bank details");
    assert.strictEqual((await Product.findById(p1._id))!.stock, 3);
    assert.strictEqual((await Product.findById(p2._id))!.stock, 0);
  });

  await step("out of stock, warranty not offered, cash at/over Rs 2 lakh refused", async () => {
    const r = await call("POST", "/dealers/orders", u2, { items: [{ productId: String(p2._id), quantity: 1 }], paymentMethod: "bank_transfer", fulfilment: { method: "pickup" } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual((await call("POST", "/dealers/orders", u2, { items: [{ productId: String(p4._id), quantity: 1, withWarranty: true }], paymentMethod: "cash", fulfilment: { method: "pickup" } })).status, 400);
    const big = await call("POST", "/dealers/orders", u2, { items: [{ productId: String(p5._id), quantity: 2 }], paymentMethod: "cash", fulfilment: { method: "pickup" } });
    assert.strictEqual(big.status, 400);
    assert.ok(/Cash/.test(big.body.message));
    assert.strictEqual((await call("POST", "/dealers/orders", u2, { items: [{ productId: String(p4._id), quantity: 1 }], paymentMethod: "cod", fulfilment: { method: "pickup" } })).status, 400);
  });

  await step("two dealers racing for the last unit: exactly one wins", async () => {
    const body = { items: [{ productId: String(p4._id), quantity: 1 }], paymentMethod: "bank_transfer", fulfilment: { method: "pickup" } };
    const rs = await Promise.all([call("POST", "/dealers/orders", u1, body), call("POST", "/dealers/orders", u2, body)]);
    // The loser gets 409 (lost the reservation) or 400 (already saw stock 0).
    assert.ok(rs.every((r) => [201, 400, 409].includes(r.status)));
    assert.strictEqual(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(rs.map((r) => [r.status, r.body.message])));
    assert.strictEqual((await Product.findById(p4._id))!.stock, 0);
    // The winner cancels: stock comes back.
    const win = rs.find((r) => r.status === 201)!;
    const who = win === rs[0] ? u1 : u2;
    const c = await call("POST", `/dealers/orders/${win.body.order.id}/cancel`, who);
    assert.strictEqual(c.status, 200);
    assert.strictEqual((await Product.findById(p4._id))!.stock, 1);
    assert.strictEqual((await call("POST", `/dealers/orders/${win.body.order.id}/cancel`, who)).status, 409);
  });

  await step("dealers can't read each other's orders or use admin routes", async () => {
    assert.strictEqual((await call("GET", `/dealers/orders/${O1.id}`, u2)).status, 404);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/payments`, u1, { method: "bank_transfer", amountPaise: 100, reference: "X" })).status, 403);
  });

  await step("payments: finance only; partial then full; duplicate UTR and overpayment refused", async () => {
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/payments`, ops, { method: "bank_transfer", amountPaise: R(10000), reference: "UTR1" })).status, 403);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/serials`, ops, { lines: [] })).status, 409); // not paid yet
    const a = await call("POST", `/admin/dealer-orders/${O1.id}/payments`, finance, { method: "bank_transfer", amountPaise: R(20000), reference: "UTR1" });
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.body.order.status, "placed");
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/payments`, finance, { method: "bank_transfer", amountPaise: R(1000), reference: "UTR1" })).status, 409);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/payments`, finance, { method: "bank_transfer", amountPaise: R(40000), reference: "UTR2" })).status, 400);
    const b = await call("POST", `/admin/dealer-orders/${O1.id}/payments`, finance, { method: "bank_transfer", amountPaise: R(33000), reference: "UTR2" });
    assert.strictEqual(b.body.order.status, "paid");
    assert.strictEqual(b.body.order.duePaise, 0);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/payments`, finance, { method: "bank_transfer", amountPaise: 100, reference: "UTR3" })).status, 409);
  });

  await step("serials: count must match, retail and dealer duplicates refused, then packed", async () => {
    const lines = O1.lines;
    const l1 = lines.find((l: any) => l.productId === String(p1._id));
    const l2 = lines.find((l: any) => l.productId === String(p2._id));
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/serials`, ops, { lines: [{ lineId: l1.id, serials: ["SN-A1"] }, { lineId: l2.id, serials: ["SN-B1"] }] })).status, 400);
    const retail = await call("POST", `/admin/dealer-orders/${O1.id}/serials`, ops, { lines: [{ lineId: l1.id, serials: ["SN-A1", "RETAIL123"] }, { lineId: l2.id, serials: ["SN-B1"] }] });
    assert.strictEqual(retail.status, 409);
    assert.ok(/LS-TEST-1/.test(retail.body.message));
    const ok = await call("POST", `/admin/dealer-orders/${O1.id}/serials`, ops, { lines: [{ lineId: l1.id, serials: ["sn-a1", "SN-A2"] }, { lineId: l2.id, serials: ["SN-B1"] }] });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.order.status, "packed");
    const units = await DealerUnit.find({ dealerOrderId: O1.id }).lean();
    assert.strictEqual(units.length, 3);
    assert.strictEqual(units.find((u) => u.serial === "SN-A1")!.warrantyMonths, 6);
    assert.strictEqual(units.find((u) => u.serial === "SN-B1")!.warrantyMonths, 0);
  });

  await step("dispatch needs courier + AWB; delivery starts the dealer's warranty", async () => {
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/dispatch`, ops, { courier: "Delhivery" })).status, 400);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/dispatch`, ops, { courier: "Delhivery", awb: "AWB1" })).body.order.status, "dispatched");
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/cancel`, superA, { reason: "x", refundNote: "y" })).status, 409);
    const d = await call("POST", `/admin/dealer-orders/${O1.id}/delivered`, ops);
    assert.strictEqual(d.body.order.status, "delivered");
    const a1: any = await DealerUnit.findOne({ serial: "SN-A1" }).lean();
    const b1: any = await DealerUnit.findOne({ serial: "SN-B1" }).lean();
    assert.ok(a1.warrantyUntil && a1.warrantyUntil.getTime() > Date.now() + 170 * 864e5);
    assert.ok(!b1.warrantyUntil);
  });

  await step("serial lookup tells support who sold it and whether warranty applies", async () => {
    const b = await call("GET", "/admin/dealer-serials/sn-b1", sales);
    assert.strictEqual(b.body.channel, "dealer");
    assert.strictEqual(b.body.warranty, null);
    assert.ok(/without Lapshark warranty/.test(b.body.summary));
    const a = await call("GET", "/admin/dealer-serials/SN-A1", ops);
    assert.strictEqual(a.body.warranty.coveredParty, "dealer");
    assert.strictEqual(a.body.warranty.active, true);
    assert.strictEqual((await call("GET", "/admin/dealer-serials/RETAIL123", sales)).body.channel, "retail");
    assert.strictEqual((await call("GET", "/admin/dealer-serials/NOPE999", sales)).status, 404);
    assert.strictEqual((await call("GET", "/admin/dealer-serials/SN-A1", u1)).status, 403);
  });

  await step("claims: damage within 7 days; warranty only where bought; one open claim per laptop", async () => {
    const c = await call("POST", `/dealers/orders/${O1.id}/claims`, u1, { type: "transit_damage", serial: "SN-A2", description: "Hinge broken when the box arrived", evidenceUrl: "https://drive.example/video" });
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    assert.strictEqual((await call("POST", `/dealers/orders/${O1.id}/claims`, u1, { type: "not_as_described", serial: "SN-A2", description: "Also wrong RAM size" })).status, 409);
    assert.strictEqual((await call("POST", `/dealers/orders/${O1.id}/claims`, u1, { type: "warranty", serial: "SN-B1", description: "Stopped booting after a month" })).status, 400);
    assert.strictEqual((await call("POST", `/dealers/orders/${O1.id}/claims`, u1, { type: "warranty", serial: "SN-A1", description: "Stopped booting after a month" })).status, 201);
    assert.strictEqual((await call("POST", `/dealers/orders/${O1.id}/claims`, u1, { type: "transit_damage", serial: "SN-ZZZ", description: "Not my laptop at all" })).status, 400);
    const claimId = c.body.order.claims[0].id;
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/claims/${claimId}/decide`, finance, { status: "replacement", resolutionNote: "x" })).status, 403);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${O1.id}/claims/${claimId}/decide`, ops, { status: "replacement" })).status, 400);
    const d = await call("POST", `/admin/dealer-orders/${O1.id}/claims/${claimId}/decide`, ops, { status: "replacement", resolutionNote: "Replacement hinge unit sent" });
    assert.strictEqual(d.body.order.claims[0].status, "replacement");
    // After 8 days the damage window has closed.
    await DealerOrder.updateOne({ _id: O1.id }, { $set: { deliveredAt: new Date(Date.now() - 8 * 864e5) } });
    const late = await call("POST", `/dealers/orders/${O1.id}/claims`, u1, { type: "transit_damage", serial: "SN-B1", description: "Found a crack on the lid" });
    assert.strictEqual(late.status, 400);
    assert.ok(/7 days/.test(late.body.message));
  });

  await step("cash + pickup: s.269ST daily limit across orders; handover delivers", async () => {
    const o2 = (await call("POST", "/dealers/orders", u2, { items: [{ productId: String(p5._id), quantity: 1 }], paymentMethod: "cash", fulfilment: { method: "pickup" } })).body.order;
    const o3 = (await call("POST", "/dealers/orders", u2, { items: [{ productId: String(p6._id), quantity: 1 }], paymentMethod: "cash", fulfilment: { method: "pickup" } })).body.order;
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${o2.id}/payments`, finance, { method: "cash", amountPaise: R(150000), reference: "RCPT-1" })).status, 200);
    const over = await call("POST", `/admin/dealer-orders/${o3.id}/payments`, finance, { method: "cash", amountPaise: R(60000), reference: "RCPT-2" });
    assert.strictEqual(over.status, 400);
    assert.ok(/below/.test(over.body.message));
    // Bank transfer for the second order is fine.
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${o3.id}/payments`, finance, { method: "bank_transfer", amountPaise: R(60000), reference: "UTR-9" })).body.order.status, "paid");
    const line = o2.lines[0];
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${o2.id}/serials`, ops, { lines: [{ lineId: line.id, serials: ["WS-0001"] }] })).status, 200);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${o2.id}/dispatch`, ops, {})).status, 400);
    const h = await call("POST", `/admin/dealer-orders/${o2.id}/dispatch`, ops, { handedTo: "Suresh (PC Hub)" });
    assert.strictEqual(h.body.order.status, "delivered");
  });

  await step("admin cancel of a paid order needs a refund note; stock and serials released", async () => {
    const o = (await call("POST", "/dealers/orders", u1, { items: [{ productId: String(p1._id), quantity: 1 }], paymentMethod: "bank_transfer", fulfilment: { method: "pickup" } })).body.order;
    assert.strictEqual((await Product.findById(p1._id))!.stock, 2);
    await call("POST", `/admin/dealer-orders/${o.id}/payments`, finance, { method: "bank_transfer", amountPaise: R(18000), reference: "UTR-C" });
    await call("POST", `/admin/dealer-orders/${o.id}/serials`, ops, { lines: [{ lineId: o.lines[0].id, serials: ["SN-C1"] }] });
    assert.strictEqual((await call("POST", `/dealers/orders/${o.id}/cancel`, u1)).status, 409);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${o.id}/cancel`, ops, { reason: "x" })).status, 403);
    assert.strictEqual((await call("POST", `/admin/dealer-orders/${o.id}/cancel`, finance, { reason: "Dealer changed mind" })).status, 400);
    const c = await call("POST", `/admin/dealer-orders/${o.id}/cancel`, finance, { reason: "Dealer changed mind", refundNote: "Refunded by NEFT, UTR R-1" });
    assert.strictEqual(c.body.order.status, "cancelled");
    assert.strictEqual((await Product.findById(p1._id))!.stock, 3);
    assert.strictEqual(await DealerUnit.countDocuments({ serial: "SN-C1" }), 0);
  });

  await step("suspension blocks the dealer at once", async () => {
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D2.id}/suspend`, sales, {})).status, 400);
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D2.id}/suspend`, sales, { reason: "Unpaid order" })).status, 200);
    assert.strictEqual((await call("GET", "/dealers/catalogue", u2)).status, 403);
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D2.id}/reactivate`, sales)).status, 403);
    assert.strictEqual((await call("PATCH", `/admin/dealers/${D2.id}/reactivate`, superA)).status, 200);
  });

  await step("separate from retail and ambassadors; everything audited", async () => {
    assert.strictEqual(await Order.countDocuments({}), 1);
    assert.strictEqual(await AmbassadorCommission.countDocuments({}), 0);
    for (const a of ["dealer.register", "dealer.approve", "dealer.price.set", "dealer.order.place", "dealer.payment.record", "dealer.order.pack", "dealer.order.dispatch", "dealer.order.deliver", "dealer.order.handover", "dealer.claim.decide", "dealer.order.cancel", "dealer.suspend"]) {
      assert.ok(await AuditLog.exists({ action: a }), a);
    }
    const ov = await call("GET", "/admin/dealers/overview", ops);
    assert.strictEqual(ov.body.dealers.approved, 2);
    assert.strictEqual(ov.body.openClaims, 1);
  });

  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(`dealer integration: ${passed} steps passed`);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
