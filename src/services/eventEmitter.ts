import axios from "axios";
import dotenv from "dotenv";
dotenv.config();
export async function emitEvent(event: {
    eventName: string;
    payload?: any;
    waId?: string;
    conversationId?: string;
}) {
    await axios.post(
        "http://localhost:3000/api/events",
        {
            eventName: event.eventName,
            payload: event.payload || {},
            waId: event.waId || "",
            conversationId: event.conversationId || ""
        },
        {
            headers: {
                "x-event-secret": process.env.EVENT_SECRET || "event-secret"
            }
        }
    );
}
