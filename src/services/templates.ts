

export const otpPayload = (to: string, otp: string) => {
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
    }
}

export const orderConfirmationCustomer = (to: string, customerName: string, orderId: string) => {
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
    }
};

export const sendAdminOrderConfirmation = (
    to: string,
    customerName: string,
    phone: string,
    orderId: string,
    amount: string,
    orderDate: string
) => {
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


export const sendAdminLoanEnquiry = (
    to: string,
    phone: string,
) => {
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

