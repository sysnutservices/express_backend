"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkServiceability = checkServiceability;
exports.createShipment = createShipment;
exports.cancelShipment = cancelShipment;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// ⚠️ Endpoint paths and payload/response field names below are placeholders
// — I don't have Ekart's actual merchant API doc (it ships with your account
// manager onboarding packet, not published publicly). The shapes here follow
// the standard Indian D2C courier API pattern (Shiprocket/Delhivery/Ekart all
// look roughly like this: pincode serviceability, forward-shipment create,
// track-by-awb, cancel-by-awb) so the plumbing — auth, retry-free single
// call, response mapping into Order.shipment — is right, but every path and
// field name here needs a side-by-side check against the real doc before
// this touches production traffic. Paths are env-overridable for exactly
// that reason: fix a mismatch by editing .env, not this file, if the shape
// otherwise matches.
const EKART_BASE_URL = process.env.EKART_BASE_URL || "https://api.ekartlogistics.com";
const EKART_API_KEY = process.env.EKART_API_KEY;
const EKART_MERCHANT_ID = process.env.EKART_MERCHANT_ID;
// Warehouse/pickup pincode shipments originate from — required by the
// serviceability and shipment-create calls, not stored per-order.
const EKART_PICKUP_PINCODE = process.env.EKART_PICKUP_PINCODE;
const client = axios_1.default.create({
    baseURL: EKART_BASE_URL,
    headers: {
        Authorization: `Bearer ${EKART_API_KEY}`,
        "Content-Type": "application/json",
    },
    timeout: 10000,
});
// Called from checkout once an address is selected, before payment — pure
// UX guardrail (see orderController.createOrder for the actual authority:
// shipment creation there is what can really fail). A network/API error here
// fails open (serviceable: true) rather than blocking checkout over a courier
// API hiccup that has nothing to do with whether the pincode is serviceable.
function checkServiceability(pincode) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const { data } = yield client.get(`/v1/serviceability/${pincode}`, {
                params: { merchant_id: EKART_MERCHANT_ID, pickup_pincode: EKART_PICKUP_PINCODE },
            });
            return {
                serviceable: !!data.serviceable,
                etaDays: data.eta_days,
                message: data.message,
            };
        }
        catch (error) {
            console.error("Ekart serviceability check failed:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
            return { serviceable: true, message: "Serviceability check unavailable" };
        }
    });
}
// Called once, when an order first moves to "Shipped" (orderController's
// updateOrderStatus guards on order.shipment?.awb already being set so this
// never double-books a shipment for the same order).
function createShipment(order) {
    return __awaiter(this, void 0, void 0, function* () {
        const isCOD = order.paymentMethod === "COD" && order.codAmount > 0;
        const { data } = yield client.post(`/v1/shipments`, {
            merchant_id: EKART_MERCHANT_ID,
            order_id: order.orderId,
            pickup_pincode: EKART_PICKUP_PINCODE,
            payment_mode: isCOD ? "cod" : "prepaid",
            order_amount: order.total,
            cod_amount: isCOD ? order.codAmount : 0,
            consignee: {
                name: order.customerName,
                address: order.shippingAddress.street,
                city: order.shippingAddress.city,
                state: order.shippingAddress.state,
                pincode: order.shippingAddress.zip,
                phone: order.shippingAddress.phone,
            },
            package: {
                weight_kg: order.totalWeightKg,
                length_cm: order.dimsCm.length,
                width_cm: order.dimsCm.width,
                height_cm: order.dimsCm.height,
            },
            items: order.items.map((i) => ({ name: i.title, quantity: i.quantity, unit_price: i.finalPrice })),
        });
        return {
            awb: data.awb || data.waybill,
            labelUrl: data.label_url,
            trackingUrl: data.tracking_url,
        };
    });
}
// Called from cancelOrder when a shipment was already booked (pre-pickup
// cancel) — best-effort: a failure here shouldn't block the order from being
// marked Cancelled on our side, so the caller logs and moves on rather than
// throwing.
function cancelShipment(awb) {
    return __awaiter(this, void 0, void 0, function* () {
        yield client.post(`/v1/shipments/${awb}/cancel`, { merchant_id: EKART_MERCHANT_ID });
    });
}
