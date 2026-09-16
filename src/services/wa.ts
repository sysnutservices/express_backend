import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

// Routes through the whatsapp-saas platform (chat.lapshark.com) instead of
// calling Meta's Graph API directly. The old direct integration used a
// personal-login User Access Token that broke every time that account's
// Facebook session was invalidated; this connection's token comes from
// Embedded Signup and doesn't carry that problem. Template ids are the
// whatsapp-saas MessageTemplate row ids (see chat.lapshark.com's Templates),
// not Meta's template names.
const WHATSAPP_SAAS_API_URL = process.env.WHATSAPP_SAAS_API_URL || "https://chat.lapshark.com/api";
const WHATSAPP_SAAS_API_KEY = process.env.WHATSAPP_SAAS_API_KEY;

const TEMPLATE_IDS = {
    otp: process.env.WHATSAPP_SAAS_OTP_TEMPLATE_ID || "87c8ce4a-6bba-4a41-88eb-fe62f814b97b",
    orderConfirmation: process.env.WHATSAPP_SAAS_ORDER_CONFIRMATION_TEMPLATE_ID || "ee0fb9d6-0f93-4504-bb71-d9ac9373ec92",
    adminOrderAlert: process.env.WHATSAPP_SAAS_ADMIN_ORDER_ALERT_TEMPLATE_ID || "77acf691-b394-450b-9049-f755b8d1b9bc",
    adminLoanAlert: process.env.WHATSAPP_SAAS_ADMIN_LOAN_ALERT_TEMPLATE_ID || "9cd3e598-3311-4b54-a1cd-684893b22e3c",
    // No default id — unlike the templates above, this one hasn't been
    // created on chat.lapshark.com yet, so there's no real id to fall back
    // to. sendAdminContactAlert below no-ops (logs, doesn't throw) until
    // WHATSAPP_SAAS_ADMIN_CONTACT_ALERT_TEMPLATE_ID is set in .env — create
    // the template there (e.g. "New contact form message from {{1}} ({{2}}):
    // {{3}}"), get it Meta-approved, then set the id.
    adminContactAlert: process.env.WHATSAPP_SAAS_ADMIN_CONTACT_ALERT_TEMPLATE_ID,
    // Same situation as adminContactAlert above — no template exists yet.
    // Create one on chat.lapshark.com (e.g. "Hi {{1}}, your order {{2}} has
    // shipped! Tracking ID: {{3}}. Track here: {{4}}"), get it
    // Meta-approved, then set WHATSAPP_SAAS_SHIPMENT_TEMPLATE_ID.
    shipmentCreated: process.env.WHATSAPP_SAAS_SHIPMENT_TEMPLATE_ID,
    delivered: process.env.WHATSAPP_SAAS_DELIVERED_TEMPLATE_ID,
    // Created on chat.lapshark.com and submitted to Meta 2026-09-14 (status
    // PENDING review at that time) — real default ids, same as
    // orderConfirmation/adminOrderAlert above, not the "no template yet"
    // pattern shipmentCreated/delivered use.
    cancellationRequested: process.env.WHATSAPP_SAAS_CANCELLATION_REQUESTED_TEMPLATE_ID || "933b5e2c-9a82-4236-a8b0-282c0d97ff4d",
    cancellationApproved: process.env.WHATSAPP_SAAS_CANCELLATION_APPROVED_TEMPLATE_ID || "408d64b4-03a7-4977-9a48-fb81745e1794",
    cancellationRejected: process.env.WHATSAPP_SAAS_CANCELLATION_REJECTED_TEMPLATE_ID || "9ca51b0e-bcc3-42ca-b925-1e0a4e9332d9",
};

// WhatsApp's Cloud API always reports an inbound sender with the country
// code (e.g. "917760772043"), but our own outbound callers (the OTP form's
// bare 10-digit validation, ADMIN_PHONE_NUMBER, a customer's stored
// `mobile`) never carry one — mismatched on chat.lapshark.com's side, each
// format created its own separate Contact/Conversation for the same real
// person. Every sendX below funnels through here, so normalizing once at
// this single point covers all of them instead of fixing (or missing, as
// cartController.ts's `91${mobile}` line by itself did) each call site.
function normalizeIndianMobile(to: string): string {
    return /^\d{10}$/.test(to) ? `91${to}` : to;
}

// No test runner in this project — this file's own self-check, run with
// `npx ts-node src/services/wa.ts`.
if (require.main === module) {
    console.assert(normalizeIndianMobile("7760772043") === "917760772043", "bare 10-digit should get 91 prefixed");
    console.assert(normalizeIndianMobile("917760772043") === "917760772043", "already-prefixed number should pass through unchanged");
    console.assert(normalizeIndianMobile("+917760772043") === "+917760772043", "a non-bare-digit format is left alone, not double-prefixed");
    console.log("normalizeIndianMobile: all checks passed");
}

async function sendTemplate(templateId: string, to: string, params: string[], tags?: string[]) {
    const response = await axios.post(
        `${WHATSAPP_SAAS_API_URL}/templates/${templateId}/send`,
        { to: normalizeIndianMobile(to), params, ...(tags ? { tags } : {}) },
        {
            headers: {
                Authorization: `Bearer ${WHATSAPP_SAAS_API_KEY}`,
                "Content-Type": "application/json",
            },
        }
    );
    return response.data;
}

export async function sendOtp(to: string, otp: string) {
    try {
        // Auto-tags the contact on chat.lapshark.com so a website
        // OTP-verification lead is identifiable/filterable in the Contacts
        // page, same as any other CRM tag.
        return await sendTemplate(TEMPLATE_IDS.otp, to, [otp], ["otp-verification"]);
    } catch (error: any) {
        console.error("WhatsApp OTP Error:", error.response?.data || error);
        throw error;
    }
}

// Our own signup (OTP-only) never asks for a name, so User.name would stay
// blank forever for anyone who hasn't separately filled it in on the Account
// page — showing as "Unknown User" in the admin Customers list. chat.lapshark.com
// already has this: its Contacts CRM backfills a contact's `name` from the
// WhatsApp profile name the moment that number sends the business its first
// inbound message (see whatsapp-saas's ContactsService.upsertFromMessage).
// Best-effort/non-throwing — most numbers won't have messaged in yet (404),
// and this is a nice-to-have backfill, not something a login should fail on.
export async function getContactName(mobile: string): Promise<string | null> {
    try {
        const response = await axios.get(
            `${WHATSAPP_SAAS_API_URL}/crm/contacts/${normalizeIndianMobile(mobile)}`,
            { headers: { Authorization: `Bearer ${WHATSAPP_SAAS_API_KEY}` } }
        );
        return response.data?.name || null;
    } catch (error: any) {
        if (error.response?.status !== 404) {
            console.error("WhatsApp Get Contact Error:", error.response?.data || error);
        }
        return null;
    }
}

export async function sendOrderConfirmation(to: string, customerName: string, orderId: string) {
    try {
        return await sendTemplate(TEMPLATE_IDS.orderConfirmation, to, [customerName, orderId]);
    } catch (error: any) {
        console.error("WhatsApp Order Confirmation Error:", error.response?.data || error);
        throw error;
    }
}

export async function sendAdminOrderConfirmationPayload(customerName: string, phone: string, orderId: string, amount: string, orderDate: string) {
    const to = process.env.ADMIN_PHONE_NUMBER!;
    try {
        return await sendTemplate(TEMPLATE_IDS.adminOrderAlert, to, [customerName, phone, orderId, amount, orderDate]);
    } catch (error: any) {
        console.error("WhatsApp Admin Order Confirmation Error:", error.response?.data || error);
        throw error;
    }
}

export async function sendAdminLoanEnquiryPayload(phone: string) {
    const to = process.env.ADMIN_PHONE_NUMBER!;
    try {
        return await sendTemplate(TEMPLATE_IDS.adminLoanAlert, to, [phone]);
    } catch (error: any) {
        console.error("WhatsApp Admin Loan Enquiry Error:", error.response?.data || error);
        throw error;
    }
}

// Truncated to a sane WhatsApp-template-friendly length — templates render
// params inline, an essay-length message field would blow past what's
// readable in a notification.
export async function sendAdminContactAlert(name: string, email: string, message: string) {
    if (!TEMPLATE_IDS.adminContactAlert) {
        console.warn(
            "sendAdminContactAlert skipped: WHATSAPP_SAAS_ADMIN_CONTACT_ALERT_TEMPLATE_ID not set. " +
            "The message was still saved to the database — this only affects the WhatsApp alert."
        );
        return null;
    }
    const to = process.env.ADMIN_PHONE_NUMBER!;
    const truncated = message.length > 300 ? message.slice(0, 297) + "..." : message;
    try {
        return await sendTemplate(TEMPLATE_IDS.adminContactAlert, to, [name, email, truncated]);
    } catch (error: any) {
        console.error("WhatsApp Admin Contact Alert Error:", error.response?.data || error);
        throw error;
    }
}

// Sent from orderController.updateOrderStatus right after a courier
// shipment is actually booked with Ekart — awb/trackingUrl are real values
// from that response, not guesses.
export async function sendShipmentConfirmation(to: string, customerName: string, orderId: string, awb: string, trackingUrl: string) {
    if (!TEMPLATE_IDS.shipmentCreated) {
        console.warn(
            "sendShipmentConfirmation skipped: WHATSAPP_SAAS_SHIPMENT_TEMPLATE_ID not set. " +
            "The shipment was still booked with Ekart — this only affects the WhatsApp notification."
        );
        return null;
    }
    try {
        return await sendTemplate(TEMPLATE_IDS.shipmentCreated, to, [customerName, orderId, awb, trackingUrl]);
    } catch (error: any) {
        console.error("WhatsApp Shipment Confirmation Error:", error.response?.data || error);
        throw error;
    }
}

// Sent from orderController — both when an admin marks an order Delivered
// by hand and when Ekart's own courier-status webhook reports it (whichever
// happens first; both call sites guard on the order not already being
// Delivered, so this only ever fires once per order).
export async function sendDeliveryConfirmation(to: string, customerName: string, orderId: string) {
    if (!TEMPLATE_IDS.delivered) {
        console.warn(
            "sendDeliveryConfirmation skipped: WHATSAPP_SAAS_DELIVERED_TEMPLATE_ID not set. " +
            "The order was still marked Delivered — this only affects the WhatsApp notification."
        );
        return null;
    }
    try {
        return await sendTemplate(TEMPLATE_IDS.delivered, to, [customerName, orderId]);
    } catch (error: any) {
        console.error("WhatsApp Delivery Confirmation Error:", error.response?.data || error);
        throw error;
    }
}

// Sent from orderController.cancelOrder when a customer submits a
// cancellation request — explicitly says no refund yet, matching the
// non-negotiable request-then-admin-approval rule this endpoint enforces.
export async function sendCancellationRequested(to: string, customerName: string, orderId: string) {
    try {
        return await sendTemplate(TEMPLATE_IDS.cancellationRequested, to, [customerName, orderId]);
    } catch (error: any) {
        console.error("WhatsApp Cancellation Requested Error:", error.response?.data || error);
        throw error;
    }
}

// Sent from orderController.cancelOrder's admin-approve branch, after the
// refund has actually been created — refundAmount is what Razorpay's
// response confirmed, not the order total.
export async function sendCancellationApproved(to: string, customerName: string, orderId: string, refundAmount: string) {
    try {
        return await sendTemplate(TEMPLATE_IDS.cancellationApproved, to, [customerName, orderId, refundAmount]);
    } catch (error: any) {
        console.error("WhatsApp Cancellation Approved Error:", error.response?.data || error);
        throw error;
    }
}

// Sent from orderController.rejectCancellation.
export async function sendCancellationRejected(to: string, customerName: string, orderId: string) {
    try {
        return await sendTemplate(TEMPLATE_IDS.cancellationRejected, to, [customerName, orderId]);
    } catch (error: any) {
        console.error("WhatsApp Cancellation Rejected Error:", error.response?.data || error);
        throw error;
    }
}
