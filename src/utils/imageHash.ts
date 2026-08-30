import crypto from "crypto";
import { ProductViewType } from "../services/imageProcessing";

// sha256 over stable-joined fields — same hashing convention as
// metaCapi.ts's sha256() helper, no new dependency. Extracted out of the
// now-removed imageCostControl.ts (AI-usage tracking) since
// productImageOrchestrator.ts's fingerprint reuse still needs it for
// catalogue_safe regardless of any AI feature's presence.
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashImageBuffer(buffer: Buffer): string {
  return sha256(buffer.toString("base64"));
}

export interface ProcessingHashInput {
  originalImageHash: string;
  viewType: ProductViewType;
  promptVersion: string;
  processingConfigVersion: string;
}

// Deliberately excludes every composition-only field (scale, position,
// offsets, shadow, canvas size, background, output format, quality) — those
// are Sharp-only and must never trigger a re-generation.
export function computeProcessingHash(input: ProcessingHashInput): string {
  return sha256([input.originalImageHash, input.viewType, input.promptVersion, input.processingConfigVersion].join("|"));
}
