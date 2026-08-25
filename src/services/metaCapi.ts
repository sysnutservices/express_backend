import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

// Meta Conversions API — server-side echo of events the browser Pixel also
// sends, so ad optimization has a truth source that doesn't depend on the
// customer's browser surviving a redirect / not running an ad-blocker.
// Inert until both env vars are set (same "must keep working with no
// credentials configured" convention as services/ekart.ts) — every call
// site here already wraps this in try/catch and treats a no-op the same as
// success, so a missing/invalid token never blocks the real request it's
// attached to.
const META_PIXEL_ID = process.env.META_PIXEL_ID;
const META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const GRAPH_API_VERSION = "v21.0";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Meta requires E.164-shaped digits (country code, no +/spaces) before
// hashing for phone matching. Indian numbers are stored as bare 10-digit
// locals throughout this codebase — prepend 91 unless it's already there.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export interface CapiUserData {
  email?: string;
  phone?: string;
  ip?: string;
  userAgent?: string;
}

export interface CapiEventInput {
  eventName: "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase" | "Lead";
  eventId?: string; // shared with the browser Pixel's eventID for dedup
  eventSourceUrl?: string;
  userData: CapiUserData;
  customData?: Record<string, unknown>;
}

export async function sendCapiEvent(input: CapiEventInput): Promise<void> {
  if (!META_PIXEL_ID || !META_CAPI_ACCESS_TOKEN) return;

  const user_data: Record<string, unknown> = {};
  if (input.userData.email) user_data.em = [sha256(input.userData.email)];
  if (input.userData.phone) user_data.ph = [sha256(normalizePhone(input.userData.phone))];
  if (input.userData.ip) user_data.client_ip_address = input.userData.ip;
  if (input.userData.userAgent) user_data.client_user_agent = input.userData.userAgent;

  await axios.post(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${META_PIXEL_ID}/events`,
    {
      data: [
        {
          event_name: input.eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: input.eventId,
          action_source: "website",
          event_source_url: input.eventSourceUrl,
          user_data,
          custom_data: input.customData || {},
        },
      ],
      access_token: META_CAPI_ACCESS_TOKEN,
    },
    { timeout: 5000 }
  );
}
