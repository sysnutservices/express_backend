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
exports.parseFbCookies = parseFbCookies;
exports.sendCapiEvent = sendCapiEvent;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const SiteConfig_1 = __importDefault(require("../models/SiteConfig"));
// Meta Conversions API — server-side echo of events the browser Pixel also
// sends, so ad optimization has a truth source that doesn't depend on the
// customer's browser surviving a redirect / not running an ad-blocker.
// Inert until credentials exist (same "must keep working with no
// credentials configured" convention as services/ekart.ts) — every call
// site here already wraps this in try/catch and treats a no-op the same as
// success, so missing/invalid credentials never block the real request
// this is attached to.
const GRAPH_API_VERSION = "v21.0";
// Credentials come from the admin Settings page (SiteConfig.analytics) when
// set there, falling back to the env vars — resolved fresh on every call
// (not a module-level constant) so pasting a new token into Settings takes
// effect immediately, no server restart needed.
function getCredentials() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const config = yield SiteConfig_1.default.findOne().select("analytics").lean();
            return {
                pixelId: ((_a = config === null || config === void 0 ? void 0 : config.analytics) === null || _a === void 0 ? void 0 : _a.metaPixelId) || process.env.META_PIXEL_ID,
                accessToken: ((_b = config === null || config === void 0 ? void 0 : config.analytics) === null || _b === void 0 ? void 0 : _b.metaCapiAccessToken) || process.env.META_CAPI_ACCESS_TOKEN,
            };
        }
        catch (_c) {
            return { pixelId: process.env.META_PIXEL_ID, accessToken: process.env.META_CAPI_ACCESS_TOKEN };
        }
    });
}
function sha256(value) {
    return crypto_1.default.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}
// Meta requires E.164-shaped digits (country code, no +/spaces) before
// hashing for phone matching. Indian numbers are stored as bare 10-digit
// locals throughout this codebase — prepend 91 unless it's already there.
function normalizePhone(phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10)
        return `91${digits}`;
    return digits;
}
// _fbp/_fbc live in the browser's cookie jar for lapshark.com, set by
// Meta's own Pixel script — not something this app sets itself. Hand-rolled
// instead of adding cookie-parser: two known cookie names, not a general
// parsing need.
function parseFbCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    const cookies = {};
    for (const pair of cookieHeader.split(";")) {
        const idx = pair.indexOf("=");
        if (idx === -1)
            continue;
        cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    }
    return { fbp: cookies["_fbp"], fbc: cookies["_fbc"] };
}
function sendCapiEvent(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { pixelId, accessToken } = yield getCredentials();
        if (!pixelId || !accessToken)
            return;
        const user_data = {};
        if (input.userData.email)
            user_data.em = [sha256(input.userData.email)];
        if (input.userData.phone)
            user_data.ph = [sha256(normalizePhone(input.userData.phone))];
        if (input.userData.ip)
            user_data.client_ip_address = input.userData.ip;
        if (input.userData.userAgent)
            user_data.client_user_agent = input.userData.userAgent;
        if (input.userData.fbp)
            user_data.fbp = input.userData.fbp;
        if (input.userData.fbc)
            user_data.fbc = input.userData.fbc;
        yield axios_1.default.post(`https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events`, {
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
            access_token: accessToken,
        }, { timeout: 5000 });
    });
}
