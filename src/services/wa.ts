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
