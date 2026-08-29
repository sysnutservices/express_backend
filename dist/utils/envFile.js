"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSafeEnvValue = isSafeEnvValue;
exports.maskSecret = maskSecret;
exports.setEnvFileValue = setEnvFileValue;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Lets an admin-only endpoint persist a single secret (currently just
// OPENAI_API_KEY) into the backend's own .env file, matching the "server
// only, never database" rule from the image-processing spec — this is a
// different persistence than DB-backed settings, not a relaxation of it.
// Resolved the same way dotenv.config() resolves it by default (relative to
// the process's cwd), since that's what every other file in this codebase
// already relies on implicitly.
const ENV_PATH = path_1.default.resolve(process.cwd(), ".env");
// No newlines/control chars — a value that could inject extra lines into the
// file (a second bogus KEY=VALUE, or corrupt the ones after it) is rejected
// outright rather than escaped.
const UNSAFE_VALUE = /[\r\n\0]/;
function isSafeEnvValue(value) {
    return typeof value === "string" && value.trim().length > 0 && !UNSAFE_VALUE.test(value);
}
// Masks everything but the last 4 characters, e.g. "sk-••••••ab12" — enough
// for an admin to recognize "yes, that's the key I pasted" without the full
// value ever being redisplayed (Phase 29: never echoed in an API response).
function maskSecret(value) {
    if (value.length <= 4)
        return "•".repeat(value.length);
    return `${"•".repeat(Math.min(6, value.length - 4))}${value.slice(-4)}`;
}
// Replaces an existing `KEY=...` line in-place (preserving every other line
// and its position) or appends a new one if the key isn't present yet.
function setEnvFileValue(key, value) {
    if (!isSafeEnvValue(value))
        throw new Error(`Refusing to write an unsafe value for ${key}`);
    const existing = fs_1.default.existsSync(ENV_PATH) ? fs_1.default.readFileSync(ENV_PATH, "utf8") : "";
    const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
    const prefix = `${key}=`;
    let replaced = false;
    const next = lines.map((line) => {
        if (line.startsWith(prefix)) {
            replaced = true;
            return `${prefix}${value}`;
        }
        return line;
    });
    if (!replaced)
        next.push(`${prefix}${value}`);
    fs_1.default.writeFileSync(ENV_PATH, next.join("\n").replace(/\n+$/, "\n"), "utf8");
    process.env[key] = value; // takes effect immediately, no restart needed
}
