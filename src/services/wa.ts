import axios from "axios";
import dotenv from "dotenv";
import { orderConfirmationCustomer, otpPayload, sendAdminLoanEnquiry, sendAdminOrderConfirmation } from "./templates";
dotenv.config();


export async function sendOtp(to: string, otp: string) {
    const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;

    try {
        const payload = otpPayload(to, otp);
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        return response.data;

    } catch (error: any) {
        console.error("WhatsApp OTP Error:", error.response?.data || error);
        throw error;
    }
}

export async function sendOrderConfirmation(to: string, customerName: string, orderId: string) {
    const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;

    try {
        const payload = orderConfirmationCustomer(to, customerName, orderId);
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        return response.data;

    } catch (error: any) {
        console.error("WhatsApp Order Confirmation Error:", error.response?.data || error);
        throw error;
    }
}



export async function sendAdminOrderConfirmationPayload(customerName: string, phone: string, orderId: string, amount: string, orderDate: string) {
    const to = process.env.ADMIN_PHONE_NUMBER!;
    const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;

    try {
        const payload = sendAdminOrderConfirmation(to, customerName, phone, orderId, amount, orderDate);
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        return response.data;

    } catch (error: any) {
        console.error("WhatsApp Admin Order Confirmation Error:", error.response?.data || error);
        throw error;
    }
}


export async function sendAdminLoanEnquiryPayload(phone: string) {
    const to = process.env.ADMIN_PHONE_NUMBER!;
    const url = `https://graph.facebook.com/v23.0/${process.env.PHONE_NUMBER_ID}/messages`;

    try {
        const payload = sendAdminLoanEnquiry(to, phone);
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        return response.data;

    } catch (error: any) {
        console.error("WhatsApp Admin Loan Enquiry Error:", error.response?.data || error);
        throw error;
    }
}

