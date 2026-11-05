import axios from "axios";
import dotenv from "dotenv";
import type { ServiceabilityResult, ShipmentResult, CreateShipmentInput } from "./ekart";
dotenv.config();

// Delhivery B2C (Delhivery One) API. Replaced Ekart as the courier for new
// shipments on 2026-11-05. Auth is a static API token from the Delhivery One
// dashboard (Settings → API Setup), sent as "Authorization: Token <token>".
// Production: track.delhivery.com. Staging: staging-express.delhivery.com.
const DELHIVERY_BASE_URL = process.env.DELHIVERY_BASE_URL || "https://track.delhivery.com";
const DELHIVERY_API_TOKEN = process.env.DELHIVERY_API_TOKEN;
// Exact (case-sensitive) name of the pickup warehouse registered in the
// Delhivery One dashboard. Return address defaults to the same warehouse.
const DELHIVERY_PICKUP_LOCATION = process.env.DELHIVERY_PICKUP_LOCATION;
// "Surface" (cheaper, slower) or "Express" (air).
const DELHIVERY_SHIPPING_MODE = process.env.DELHIVERY_SHIPPING_MODE || "Surface";
const SELLER_NAME = process.env.DELHIVERY_SELLER_NAME || process.env.EKART_SELLER_NAME;
const SELLER_ADDRESS = process.env.DELHIVERY_SELLER_ADDRESS || process.env.EKART_SELLER_ADDRESS;
const SELLER_GST_TIN = process.env.DELHIVERY_SELLER_GST_TIN || process.env.EKART_SELLER_GST_TIN;

export const delhiveryConfigured = () => !!DELHIVERY_API_TOKEN;

export const delhiveryTrackingUrl = (awb: string) => `https://www.delhivery.com/track-v2/package/${encodeURIComponent(awb)}`;

const client = axios.create({ baseURL: DELHIVERY_BASE_URL, timeout: 15000 });
const authHeaders = () => {
  if (!DELHIVERY_API_TOKEN) throw new Error("DELHIVERY_API_TOKEN not configured");
  return { Authorization: `Token ${DELHIVERY_API_TOKEN}`, Accept: "application/json" };
};

// Delhivery's create API is form-encoded JSON and its docs warn that & # % ;
// and backslash inside field values break or truncate the shipment. Replace
// them (and newlines) with spaces.
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/[&#%;\\]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();

const tenDigitPhone = (raw: string) => (raw || "").replace(/\D/g, "").slice(-10);

// Checkout's pincode check. Delhivery's pincode API returns an empty
// delivery_codes list for pincodes it doesn't serve, and remarks "Embargo"
// for ones temporarily blocked. Fails open on API errors, like the Ekart
// version: a courier API hiccup shouldn't block checkout.
export async function checkServiceability(pincode: string): Promise<ServiceabilityResult> {
  try {
    const { data } = await client.get("/c/api/pin-codes/json/", {
      headers: authHeaders(),
      params: { filter_codes: pincode },
    });
    const pc = data?.delivery_codes?.[0]?.postal_code;
    if (!pc) return { serviceable: false, message: "Not serviceable to this pincode" };
    const embargo = /embargo/i.test(pc.remarks || "");
    const prepaid = String(pc.pre_paid || "").toUpperCase() === "Y";
    const cod = String(pc.cod || "").toUpperCase() === "Y";
    if (embargo || (!prepaid && !cod)) {
      return { serviceable: false, message: "Delivery to this pincode is temporarily unavailable" };
    }
    return { serviceable: true };
  } catch (error: any) {
    console.error("Delhivery serviceability check failed:", error.response?.data || error.message);
    return { serviceable: true, message: "Serviceability check unavailable" };
  }
}

// Called once, when an order first moves to "Shipped". Waybill is left blank
// so Delhivery assigns one. Throws with Delhivery's own remarks on failure
// (e.g. pincode not serviceable, duplicate order id) so the admin sees why.
export async function createShipment(order: CreateShipmentInput): Promise<ShipmentResult> {
  if (!DELHIVERY_PICKUP_LOCATION) throw new Error("DELHIVERY_PICKUP_LOCATION not configured");
  const isCOD = order.paymentMethod === "COD" && order.codAmount > 0;
  const quantity = order.items.reduce((sum, i) => sum + i.quantity, 0) || 1;

  const payload = {
    shipments: [
      {
        name: clean(order.customerName),
        add: clean(order.shippingAddress.street),
        pin: String(order.shippingAddress.zip).trim(),
        city: clean(order.shippingAddress.city),
        state: clean(order.shippingAddress.state),
        country: "India",
        phone: tenDigitPhone(order.shippingAddress.phone),
        order: order.orderId,
        payment_mode: isCOD ? "COD" : "Prepaid",
        cod_amount: isCOD ? String(order.codAmount) : "0",
        total_amount: String(order.total),
        order_date: new Date().toISOString(),
        products_desc: clean(order.items.map((i) => `${i.title} x${i.quantity}`).join(", ")).slice(0, 500),
        quantity: String(quantity),
        seller_name: clean(SELLER_NAME),
        seller_add: clean(SELLER_ADDRESS),
        seller_gst_tin: SELLER_GST_TIN || "",
        seller_inv: order.orderId,
        waybill: "",
        weight: String(Math.max(1, Math.round(order.totalWeightKg * 1000))), // grams
        shipment_length: String(order.dimsCm.length),
        shipment_width: String(order.dimsCm.width),
        shipment_height: String(order.dimsCm.height),
        shipping_mode: DELHIVERY_SHIPPING_MODE,
        address_type: "home",
      },
    ],
    pickup_location: { name: DELHIVERY_PICKUP_LOCATION },
  };

  const { data } = await client.post(
    "/api/cmu/create.json",
    `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`,
    { headers: { ...authHeaders(), "Content-Type": "application/x-www-form-urlencoded" } }
  );

  const pkg = data?.packages?.[0];
  if (!data?.success || !pkg?.waybill || String(pkg.status).toLowerCase() !== "success") {
    const remarks = [pkg?.remarks, data?.rmk].flat().filter(Boolean).join("; ");
    const err: any = new Error(`Delhivery rejected the shipment${remarks ? `: ${remarks}` : ""}`);
    err.courierMessage = remarks || undefined;
    err.response = { data };
    throw err;
  }

  return { awb: String(pkg.waybill), trackingUrl: delhiveryTrackingUrl(String(pkg.waybill)) };
}

// Best-effort pre-pickup cancel, same contract as ekart.cancelShipment.
export async function cancelShipment(awb: string): Promise<void> {
  const { data } = await client.post(
    "/api/p/edit",
    { waybill: awb, cancellation: "true" },
    { headers: { ...authHeaders(), "Content-Type": "application/json" } }
  );
  if (data && data.status === false) {
    throw Object.assign(new Error(`Delhivery cancel failed: ${data.remark || data.error || "unknown"}`), { response: { data } });
  }
}

export interface TrackedStatus {
  awb: string;
  status: string; // e.g. "In Transit", "Dispatched", "Delivered", "RTO"
  statusType: string; // UD (forward), DL (delivered), RT (return), CN (cancelled), PU (pickup)
}

// Current status for up to 50 waybills per call.
export async function trackShipments(awbs: string[]): Promise<TrackedStatus[]> {
  if (!awbs.length) return [];
  const { data } = await client.get("/api/v1/packages/json/", {
    headers: authHeaders(),
    params: { waybill: awbs.slice(0, 50).join(",") },
  });
  return (data?.ShipmentData || [])
    .map((d: any) => d?.Shipment)
    .filter((s: any) => s?.AWB && s?.Status)
    .map((s: any) => ({ awb: String(s.AWB), status: String(s.Status.Status || ""), statusType: String(s.Status.StatusType || "") }));
}

// Delhivery status → our order status. undefined = no change (e.g.
// "Manifested"/"Not Picked": booked but not collected yet; "CN": cancelled).
export function mapDelhiveryStatus(status: string, statusType: string): string | undefined {
  const st = statusType.toUpperCase();
  const s = status.trim().toLowerCase();
  if (st === "RT") return "RTO";
  if (st === "DL") return s === "delivered" ? "Delivered" : "RTO"; // DL + "RTO"/"DTO" = returned to us
  if (st === "UD") {
    if (s === "dispatched") return "Out for Delivery";
    if (s === "in transit" || s === "pending") return "Shipped";
  }
  return undefined;
}
