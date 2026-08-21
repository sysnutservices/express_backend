"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAdminLoanEnquiry = exports.sendAdminOrderConfirmation = exports.orderConfirmationCustomer = exports.otpPayload = void 0;
const otpPayload = (to, otp) => {
    return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
            name: "otp_authentication",
            language: { code: "en" },
            components: [
                {
                    type: "body",
                    parameters: [
                        { type: "text", text: otp }
                    ]
                },
                {
                    type: "button",
                    sub_type: "url",
                    index: "0",
                    parameters: [
                        { type: "text", text: otp }
                    ]
                }
            ]
        }
    };
};
exports.otpPayload = otpPayload;
const orderConfirmationCustomer = (to, customerName, orderId) => {
    return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
            name: "order_management_4",
            language: {
                code: "en_US"
            },
            components: [
                {
                    type: "body",
                    parameters: [
                        {
                            type: "text",
                            text: customerName
                        },
                        {
                            type: "text",
                            text: orderId
                        }
                    ]
                },
                {
                    type: "button",
                    sub_type: "url",
                    index: 0,
                    parameters: [
                        {
                            type: "text",
                            text: orderId
                        }
                    ]
                }
            ]
        }
    };
};
exports.orderConfirmationCustomer = orderConfirmationCustomer;
const sendAdminOrderConfirmation = (to, customerName, phone, orderId, amount, orderDate) => {
    return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
            name: "admin_order_confirmation",
            language: {
                code: "en_US",
            },
            components: [
                {
                    type: "BODY",
                    parameters: [
                        { type: "text", text: customerName },
                        { type: "text", text: phone },
                        { type: "text", text: orderId },
                        { type: "text", text: amount },
                        { type: "text", text: orderDate },
                    ],
                },
            ],
        },
    };
};
exports.sendAdminOrderConfirmation = sendAdminOrderConfirmation;
const sendAdminLoanEnquiry = (to, phone) => {
    return {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
            name: "new_account_alert",
            language: {
                code: "en_US",
            },
            components: [
                {
                    type: "BODY",
                    parameters: [
                        { type: "text", text: phone },
                    ],
                },
            ],
        },
    };
};
exports.sendAdminLoanEnquiry = sendAdminLoanEnquiry;
