// Runnable self-check for services/delhivery.ts against a local fake
// Delhivery server: no real network, no Delhivery account needed.
// Run: npx ts-node src/services/delhivery.selftest.ts (or `npm test`)
import assert from "assert";
import http from "http";
import type { AddressInfo } from "net";

async function main() {
  const seen: { method: string; url: string; auth?: string; body: string }[] = [];
  let createReply: any = { success: true, packages: [{ status: "Success", waybill: "1234567890123", remarks: [] }] };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
      res.setHeader("Content-Type", "application/json");
      const url = new URL(req.url!, "http://x");
      if (url.pathname === "/c/api/pin-codes/json/") {
        const pin = url.searchParams.get("filter_codes");
        const codes =
          pin === "560001" ? [{ postal_code: { pin: 560001, pre_paid: "Y", cod: "Y", remarks: "" } }]
          : pin === "110001" ? [{ postal_code: { pin: 110001, pre_paid: "Y", cod: "N", remarks: "Embargo" } }]
          : pin === "400001" ? [{ postal_code: { pin: 400001, pre_paid: "Y", cod: "Y", remarks: "", max_amount: 0 } }]
          : pin === "700001" ? [{ postal_code: { pin: 700001, pre_paid: "Y", cod: "N", remarks: "" } }]
          : pin === "600001" ? [{ postal_code: { pin: 600001, pre_paid: "Y", cod: "Y", remarks: "", max_amount: 20000 } }]
          : [];
        return res.end(JSON.stringify({ delivery_codes: codes }));
      }
      if (url.pathname === "/api/cmu/create.json") return res.end(JSON.stringify(createReply));
      if (url.pathname === "/api/p/edit") return res.end(JSON.stringify({ status: true }));
      if (url.pathname === "/api/v1/packages/json/") {
        return res.end(JSON.stringify({
          ShipmentData: [
            { Shipment: { AWB: "A1", Status: { Status: "Dispatched", StatusType: "UD" } } },
            { Shipment: { AWB: "A2", Status: { Status: "Delivered", StatusType: "DL" } } },
          ],
        }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  process.env.DELHIVERY_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.DELHIVERY_API_TOKEN = "test-token";
  process.env.DELHIVERY_PICKUP_LOCATION = "Lapshark Bangalore";
  // Imported after env is set: the module reads env at load time.
  const d = await import("./delhivery");

  try {
    // Serviceability: served, embargoed, unknown.
    assert.deepStrictEqual(await d.checkServiceability("560001"), { serviceable: true, cod: true });
    assert.deepStrictEqual(await d.checkServiceability("700001"), { serviceable: true, cod: false });
    assert.strictEqual((await d.checkServiceability("110001")).serviceable, false);
    assert.strictEqual((await d.checkServiceability("999999")).serviceable, false);
    assert.strictEqual(seen[0].auth, "Token test-token");

    // COD at order creation: Delhivery's cod flag, embargo, per-pincode cap.
    assert.strictEqual(await d.checkCod("560001", 21500), true);
    assert.strictEqual(await d.checkCod("400001", 90000), true); // max_amount 0 = no cap
    assert.strictEqual(await d.checkCod("700001", 21500), false); // prepaid-only pincode
    assert.strictEqual(await d.checkCod("110001", 21500), false); // embargoed
    assert.strictEqual(await d.checkCod("999999", 21500), false); // not served
    assert.strictEqual(await d.checkCod("600001", 19500), true);
    assert.strictEqual(await d.checkCod("600001", 21500), false); // over the cap

    // Create: form-encoded JSON, COD amount, cleaned address, grams.
    const input = {
      orderId: "LS-20261105-01",
      customerName: "Asha & Co",
      shippingAddress: { street: "12, 3rd Cross; #4\nIndiranagar", city: "Bengaluru", state: "Karnataka", zip: "560038", phone: "+91 98450 12345" },
      total: 22000,
      paymentMethod: "COD",
      codAmount: 21500,
      items: [{ title: "Dell Latitude 5490", quantity: 1, finalPrice: 22000 }],
      totalWeightKg: 2.5,
      dimsCm: { length: 35, width: 25, height: 8 },
    };
    const r = await d.createShipment(input);
    assert.strictEqual(r.awb, "1234567890123");
    assert.strictEqual(r.trackingUrl, "https://www.delhivery.com/track-v2/package/1234567890123");
    const createReq = seen.find((s) => s.url.startsWith("/api/cmu/create.json"))!;
    const form = new URLSearchParams(createReq.body);
    assert.strictEqual(form.get("format"), "json");
    const sent = JSON.parse(form.get("data")!);
    const sh = sent.shipments[0];
    assert.strictEqual(sent.pickup_location.name, "Lapshark Bangalore");
    assert.strictEqual(sh.payment_mode, "COD");
    assert.strictEqual(sh.cod_amount, "21500");
    assert.strictEqual(sh.phone, "9845012345");
    assert.strictEqual(sh.weight, "2500");
    assert.strictEqual(sh.order, "LS-20261105-01");
    assert.ok(!/[&#%;\\\n]/.test(sh.add + sh.name), `unclean: ${sh.add} / ${sh.name}`);

    // Prepaid when nothing is left to collect.
    await d.createShipment({ ...input, codAmount: 0 });
    const prepaid = JSON.parse(new URLSearchParams(seen[seen.length - 1].body).get("data")!).shipments[0];
    assert.strictEqual(prepaid.payment_mode, "Prepaid");
    assert.strictEqual(prepaid.cod_amount, "0");

    // Rejection surfaces Delhivery's remarks.
    createReply = { success: false, packages: [{ status: "Fail", waybill: "", remarks: ["Duplicate order id"] }], rmk: "" };
    await assert.rejects(() => d.createShipment(input), (e: any) => e.courierMessage === "Duplicate order id");

    // Cancel + tracking.
    await d.cancelShipment("1234567890123");
    assert.deepStrictEqual(JSON.parse(seen[seen.length - 1].body), { waybill: "1234567890123", cancellation: "true" });
    const tracked = await d.trackShipments(["A1", "A2"]);
    assert.deepStrictEqual(tracked.map((t) => t.awb), ["A1", "A2"]);

    // Status mapping.
    assert.strictEqual(d.mapDelhiveryStatus("Manifested", "UD"), undefined);
    assert.strictEqual(d.mapDelhiveryStatus("In Transit", "UD"), "Shipped");
    assert.strictEqual(d.mapDelhiveryStatus("Pending", "UD"), "Shipped");
    assert.strictEqual(d.mapDelhiveryStatus("Dispatched", "UD"), "Out for Delivery");
    assert.strictEqual(d.mapDelhiveryStatus("Delivered", "DL"), "Delivered");
    assert.strictEqual(d.mapDelhiveryStatus("In Transit", "RT"), "RTO");
    assert.strictEqual(d.mapDelhiveryStatus("RTO", "DL"), "RTO");
    assert.strictEqual(d.mapDelhiveryStatus("Canceled", "CN"), undefined);

    console.log("delhivery selftest: all passed");
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
