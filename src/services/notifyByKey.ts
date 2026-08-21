import EventDefinition from "../models/EventDefinition";
import { emitEvent } from "./eventEmitter";

export async function notifyByKey(
    eventKey: string,
    options: {
        waId?: string;        // 🔥 REQUIRED for WhatsApp
        entityId?: string;
        payload?: any;
        req?: any;
    }
) {
    // 1️⃣ Validate event exists
    const eventDef = await EventDefinition.findOne({
        key: eventKey,
        enabled: true
    }).lean();

    if (!eventDef) {
        console.warn(`[EVENT SKIPPED] Not registered: ${eventKey}`);
        return;
    }

    // 2️⃣ Emit event to WhatsApp backend
    await emitEvent({
        eventName: eventDef.key,
        waId: options.waId || "",      // 🔥 IMPORTANT
        payload: {
            entityId: options.entityId,
            ...options.payload
        }
    });
}
