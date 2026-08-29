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
exports.sendOtp = sendOtp;
exports.sendOrderConfirmation = sendOrderConfirmation;
exports.sendAdminOrderConfirmationPayload = sendAdminOrderConfirmationPayload;
exports.sendAdminLoanEnquiryPayload = sendAdminLoanEnquiryPayload;
exports.sendAdminContactAlert = sendAdminContactAlert;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
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
};
// WhatsApp's Cloud API always reports an inbound sender with the country
// code (e.g. "917760772043"), but our own outbound callers (the OTP form's
// bare 10-digit validation, ADMIN_PHONE_NUMBER, a customer's stored
// `mobile`) never carry one — mismatched on chat.lapshark.com's side, each
// format created its own separate Contact/Conversation for the same real
// person. Every sendX below funnels through here, so normalizing once at
// this single point covers all of them instead of fixing (or missing, as
// cartController.ts's `91${mobile}` line by itself did) each call site.
function normalizeIndianMobile(to) {
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
function sendTemplate(templateId, to, params, tags) {
    return __awaiter(this, void 0, void 0, function* () {
        const response = yield axios_1.default.post(`${WHATSAPP_SAAS_API_URL}/templates/${templateId}/send`, Object.assign({ to: normalizeIndianMobile(to), params }, (tags ? { tags } : {})), {
            headers: {
                Authorization: `Bearer ${WHATSAPP_SAAS_API_KEY}`,
                "Content-Type": "application/json",
            },
        });
        return response.data;
    });
}
function sendOtp(to, otp) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            // Auto-tags the contact on chat.lapshark.com so a website
            // OTP-verification lead is identifiable/filterable in the Contacts
            // page, same as any other CRM tag.
            return yield sendTemplate(TEMPLATE_IDS.otp, to, [otp], ["otp-verification"]);
        }
        catch (error) {
            console.error("WhatsApp OTP Error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error);
            throw error;
        }
    });
}
function sendOrderConfirmation(to, customerName, orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            return yield sendTemplate(TEMPLATE_IDS.orderConfirmation, to, [customerName, orderId]);
        }
        catch (error) {
            console.error("WhatsApp Order Confirmation Error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error);
            throw error;
        }
    });
}
function sendAdminOrderConfirmationPayload(customerName, phone, orderId, amount, orderDate) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const to = process.env.ADMIN_PHONE_NUMBER;
        try {
            return yield sendTemplate(TEMPLATE_IDS.adminOrderAlert, to, [customerName, phone, orderId, amount, orderDate]);
        }
        catch (error) {
            console.error("WhatsApp Admin Order Confirmation Error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error);
            throw error;
        }
    });
}
function sendAdminLoanEnquiryPayload(phone) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const to = process.env.ADMIN_PHONE_NUMBER;
        try {
            return yield sendTemplate(TEMPLATE_IDS.adminLoanAlert, to, [phone]);
        }
        catch (error) {
            console.error("WhatsApp Admin Loan Enquiry Error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error);
            throw error;
        }
    });
}
// Truncated to a sane WhatsApp-template-friendly length — templates render
// params inline, an essay-length message field would blow past what's
// readable in a notification.
function sendAdminContactAlert(name, email, message) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!TEMPLATE_IDS.adminContactAlert) {
            console.warn("sendAdminContactAlert skipped: WHATSAPP_SAAS_ADMIN_CONTACT_ALERT_TEMPLATE_ID not set. " +
                "The message was still saved to the database — this only affects the WhatsApp alert.");
            return null;
        }
        const to = process.env.ADMIN_PHONE_NUMBER;
        const truncated = message.length > 300 ? message.slice(0, 297) + "..." : message;
        try {
            return yield sendTemplate(TEMPLATE_IDS.adminContactAlert, to, [name, email, truncated]);
        }
        catch (error) {
            console.error("WhatsApp Admin Contact Alert Error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error);
            throw error;
        }
    });
}
