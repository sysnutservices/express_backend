import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

// Verified against Ekart Elite's actual OpenAPI spec (docs at
// app.elite.ekartlogistics.in/api/docs, spec.yaml linked from there) —
// unlike the old version of this file, these paths/fields/response shapes
// are the real ones, not guesses. Two things are still not fully nailed
// down and are called out where they matter below: checkServiceability
// necessarily uses placeholder package/order values (real order details
// don't exist yet at the pre-checkout point it's called from), and the
// inbound webhook signature format (shipmentWebhook in orderController.ts)
// isn't in this spec at all — registering a real webhook and verifying its
// signature scheme is still open.
const EKART_BASE_URL = process.env.EKART_BASE_URL || "https://app.elite.ekartlogistics.in";
const EKART_CLIENT_ID = process.env.EKART_CLIENT_ID;
const EKART_USERNAME = process.env.EKART_USERNAME;
const EKART_PASSWORD = process.env.EKART_PASSWORD;
const EKART_SELLER_GST_TIN = process.env.EKART_SELLER_GST_TIN;
const EKART_SELLER_NAME = process.env.EKART_SELLER_NAME;
const EKART_SELLER_ADDRESS = process.env.EKART_SELLER_ADDRESS;
// The alias of the warehouse address already registered with Ekart (via
// their dashboard/account manager) — sending just this instead of a full
// pickup_location object is Ekart's own documented shorthand, and saves
// re-sending the same address on every shipment. return_location is left
// unset in createShipment below for the same reason — Ekart defaults it to
// the pickup_location when omitted.
const EKART_PICKUP_ALIAS = process.env.EKART_PICKUP_ALIAS;
const EKART_PICKUP_PINCODE = process.env.EKART_PICKUP_PINCODE;

const client = axios.create({ baseURL: EKART_BASE_URL, timeout: 10000 });

// ---- Auth ----
// Not a static API key: POST username/password to get a bearer access_token
// valid ~24h (their own "caching API" note says the same token comes back
// for repeated fetches within that window, so this cache just avoids an
// unnecessary round trip — Ekart itself would also just hand back the same
// token). Refreshed 60s before actual expiry to avoid a request racing an
// expiring token.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { data } = await client.post(
    `/integrations/v2/auth/token/${encodeURIComponent(EKART_CLIENT_ID || "")}`,
    { username: EKART_USERNAME, password: EKART_PASSWORD }
  );
  cachedToken = {
    value: `${data.token_type} ${data.access_token}`,
    expiresAt: Date.now() + Math.max(0, (data.expires_in - 60)) * 1000,
  };
  return cachedToken.value;
}

async function authHeaders() {
  return { Authorization: await getAccessToken() };
}

// Ekart wants a plain 10-digit number for phone fields (locationV1/shipment
// schemas both type it as an integer 1000000000-9999999999) — strip
// anything else (a stored +91/91 prefix, spaces, dashes) and take the last
// 10 digits rather than assume the stored format is already clean.
function tenDigitPhone(raw: string): number {
  return Number((raw || "").replace(/\D/g, "").slice(-10));
}

export interface ServiceabilityResult {
  serviceable: boolean;
  etaDays?: number;
  message?: string;
}

// Called from checkout once an address is selected, before payment — pure
// UX guardrail (see orderController.createOrder for the actual authority:
// shipment creation there is what can really fail). A network/API error here
// fails open (serviceable: true) rather than blocking checkout over a courier
// API hiccup that has nothing to do with whether the pincode is serviceable.
// ponytail: the real /data/v3/serviceability call needs package dims/weight
// and a payment type + invoice amount to price the shipment, none of which
// exist yet at this point in the flow (no order, no cart total in scope
// here) — uses the same representative-laptop defaults updateOrderStatus
// falls back to (2.5kg, 35x25x8cm) and a nominal COD/₹10,000 guess. Good
// enough for a go/no-go signal on the pincode; not meant to be exact.
export async function checkServiceability(pincode: string): Promise<ServiceabilityResult> {
  try {
    const headers = await authHeaders();
    const { data } = await client.post(
      "/data/v3/serviceability",
      {
        pickupPincode: EKART_PICKUP_PINCODE,
        dropPincode: pincode,
        length: "35",
        width: "25",
        height: "8",
        weight: "2500",
        paymentType: "COD",
        codAmount: "500",
        invoiceAmount: "10000",
      },
      { headers }
    );
    const options = Array.isArray(data) ? data : [];
    return {
      serviceable: options.length > 0,
      etaDays: options[0]?.tat?.max,
      message: options.length ? undefined : "Not serviceable to this pincode",
    };
  } catch (error: any) {
    console.error("Ekart serviceability check failed:", error.response?.data || error.message);
    return { serviceable: true, message: "Serviceability check unavailable" };
  }
}

export interface ShipmentResult {
  awb: string;
  trackingUrl?: string;
  // Not fetched yet — Ekart's create response doesn't include a label URL
  // directly, that's a separate GET /api/v1/package/label call. Left
  // undefined until that's wired up; Order.shipment.labelUrl is optional so
  // this degrades fine (admin just won't see a label link yet).
  labelUrl?: string;
}

// Called once, when an order first moves to "Shipped" (orderController's
// updateOrderStatus guards on order.shipment?.awb already being set so this
// never double-books a shipment for the same order).
export async function createShipment(order: {
  orderId: string;
  customerName: string;
  shippingAddress: { street: string; city: string; state: string; zip: string; phone: string };
  total: number;
  paymentMethod: string;
  // Amount the courier should collect in cash on delivery — 0 for a fully
  // prepaid order, (total - advance) for COD. Not derived from paymentStatus:
  // a COD order's ₹500 advance also lands paymentStatus "Paid", so that
  // alone can't tell prepaid and COD apart any more.
  codAmount: number;
  items: Array<{ title: string; quantity: number; finalPrice: number }>;
  totalWeightKg: number;
  dimsCm: { length: number; width: number; height: number };
}): Promise<ShipmentResult> {
  const isCOD = order.paymentMethod === "COD" && order.codAmount > 0;
  const phone = tenDigitPhone(order.shippingAddress.phone);
  const productsDesc = order.items.map((i) => `${i.title} x${i.quantity}`).join(", ").slice(0, 500);
  const quantity = order.items.reduce((sum, i) => sum + i.quantity, 0) || 1;

  const headers = await authHeaders();
  const { data } = await client.put(
    "/api/v1/package/create",
    {
      order_number: order.orderId,
      invoice_number: order.orderId,
      invoice_date: new Date().toISOString().slice(0, 10),
      seller_name: EKART_SELLER_NAME,
      seller_address: EKART_SELLER_ADDRESS,
      seller_gst_tin: EKART_SELLER_GST_TIN,
      // No GST charged on orders — kept at 0 rather than left off, since
      // Ekart's schema marks these required.
      consignee_gst_amount: 0,
      tax_value: 0,
      taxable_amount: order.total,
      commodity_value: String(order.total),
      total_amount: order.total,
      cod_amount: isCOD ? order.codAmount : 0,
      consignee_name: order.customerName,
      consignee_alternate_phone: String(phone),
      payment_mode: isCOD ? "COD" : "Prepaid",
      category_of_goods: "Electronics",
      products_desc: productsDesc,
      quantity,
      weight: Math.max(1, Math.round(order.totalWeightKg * 1000)), // kg -> grams
      length: order.dimsCm.length,
      height: order.dimsCm.height,
      width: order.dimsCm.width,
      // return_reason is only meaningful for a reverse ("Pickup") shipment —
      // Lapshark doesn't do return pickups through this API yet, so this is
      // always a forward shipment and the field is empty. Ekart's own docs
      // say it's "not required for Forward Shipments" despite the OpenAPI
      // schema marking it required — if that turns out to be strictly
      // enforced, this is the first thing to fix from the real error.
      return_reason: "",
      drop_location: {
        address: order.shippingAddress.street,
        city: order.shippingAddress.city,
        state: order.shippingAddress.state,
        country: "India",
        name: order.customerName,
        phone,
        pin: Number(order.shippingAddress.zip),
      },
      // Alias shorthand (see EKART_PICKUP_ALIAS above) — return_location
      // intentionally omitted, defaults to this same address per Ekart's docs.
      pickup_location: { name: EKART_PICKUP_ALIAS },
    },
    { headers }
  );

  return {
    awb: data.tracking_id,
    trackingUrl: data.tracking_id ? `${EKART_BASE_URL}/track/${data.tracking_id}` : undefined,
  };
}

// Called from cancelOrder when a shipment was already booked (pre-pickup
// cancel) — best-effort: a failure here shouldn't block the order from being
// marked Cancelled on our side, so the caller logs and moves on rather than
// throwing.
export async function cancelShipment(awb: string): Promise<void> {
  const headers = await authHeaders();
  await client.delete("/api/v1/package/cancel", { headers, params: { tracking_id: awb } });
}
