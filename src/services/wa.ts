import axios from "axios";
import dotenv from "dotenv";
dotenv.config();


export async function sendOtp(to: string, otp: string) {
    const url = `https://graph.facebook.com/v20.0/${process.env.PHONE_NUMBER_ID}/messages`;

    const payload = {
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

    try {
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
