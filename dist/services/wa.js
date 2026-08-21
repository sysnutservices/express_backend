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
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const templates_1 = require("./templates");
dotenv_1.default.config();
function sendOtp(to, otp) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;
        try {
            const payload = (0, templates_1.otpPayload)(to, otp);
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
            });
            return response.data;
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
        const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;
        try {
            const payload = (0, templates_1.orderConfirmationCustomer)(to, customerName, orderId);
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
            });
            return response.data;
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
        const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;
        try {
            const payload = (0, templates_1.sendAdminOrderConfirmation)(to, customerName, phone, orderId, amount, orderDate);
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
            });
            return response.data;
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
        const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;
        try {
            const payload = (0, templates_1.sendAdminLoanEnquiry)(to, phone);
            const response = yield axios_1.default.post(url, payload, {
                headers: {
                    Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                    "Content-Type": "application/json",
                },
            });
            return response.data;
        }
        catch (error) {
            console.error("WhatsApp Admin Loan Enquiry Error:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error);
            throw error;
        }
    });
}
