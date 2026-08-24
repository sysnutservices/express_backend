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

async function sendTemplate(templateId: string, to: string, params: string[]) {
    const response = await axios.post(
        `${WHATSAPP_SAAS_API_URL}/templates/${templateId}/send`,
        { to, params },
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
        return await sendTemplate(TEMPLATE_IDS.otp, to, [otp]);
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
