// AES-256-GCM for PAN / payout details, HMAC-SHA256 for duplicate detection.
// Keys come only from env and the module fails closed (throws) when absent —
// plaintext is never stored as a fallback. See docs/05 §5.4.
import crypto from "crypto";

export class SensitiveDataUnavailable extends Error {
  constructor(msg = "Sensitive-data encryption is not configured") {
    super(msg);
  }
}

function key(name: "AMBASSADOR_ENC_KEY" | "AMBASSADOR_HASH_KEY"): Buffer {
  const raw = process.env[name];
  if (!raw) throw new SensitiveDataUnavailable(`${name} is not set`);
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new SensitiveDataUnavailable(`${name} must be 32 bytes, base64-encoded`);
  return buf;
}

export function encryptionConfigured(): boolean {
  try {
    key("AMBASSADOR_ENC_KEY");
    key("AMBASSADOR_HASH_KEY");
    return true;
  } catch {
    return false;
  }
}

// Output: "v1:<iv b64>:<tag b64>:<ciphertext b64>"
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key("AMBASSADOR_ENC_KEY"), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, ct] = payload.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised ciphertext format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key("AMBASSADOR_ENC_KEY"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

export function hmac(value: string): string {
  return crypto.createHmac("sha256", key("AMBASSADOR_HASH_KEY")).update(value).digest("hex");
}

export function maskPan(pan: string): string {
  return "XXXXXX" + pan.slice(-4);
}

export function maskAccount(accountNumber: string): string {
  return "XXXX" + accountNumber.slice(-4);
}

export function maskUpi(upi: string): string {
  const [name, handle] = upi.split("@");
  if (!handle) return "***";
  return `${name.slice(0, 2)}***@${handle}`;
}
