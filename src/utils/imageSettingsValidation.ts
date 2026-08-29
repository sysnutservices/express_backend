// Extracted from productController.ts: the new productImageController.ts
// needs the exact same untrusted-settings validation, and two controllers
// needing it is the signal to share it once instead of duplicating it.
import { ViewPreset } from "../services/imageProcessing";

// Multipart fields arrive as strings — `settings` is sent as a JSON string
// when present (mirrors how `viewType` is just a plain field). Invalid JSON
// is treated as "no overrides" rather than a hard error, since composition
// overrides are optional.
export function parseSettingsField(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export const SETTINGS_NUMERIC_RANGES: Record<string, [number, number]> = {
  scale: [0.3, 1],
  xOffset: [-1000, 1000],
  yOffset: [-1000, 1000],
  brightness: [0.5, 1.5],
  contrast: [0.5, 1.5],
  saturation: [0, 2],
  shadowOpacity: [0, 1],
  shadowBlur: [0, 200],
  shadowOffsetX: [-200, 200],
  shadowOffsetY: [-200, 200],
  quality: [1, 100],
};
export const VALID_POSITIONS = new Set([
  'center', 'center-top', 'center-bottom', 'left', 'right',
  'top-left', 'top-center', 'top-right', 'center-left', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);
export const VALID_OUTPUT_FORMATS = new Set(['webp', 'jpeg', 'png']);

// Untrusted request input — every field is checked against a known type/range
// before being allowed through; anything invalid or unrecognized is silently
// dropped rather than passed on to Sharp.
export function sanitizeSettings(raw: unknown): Partial<ViewPreset> | undefined {
  const obj = parseSettingsField(raw);
  if (!obj) return undefined;
  const out: Partial<ViewPreset> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key in SETTINGS_NUMERIC_RANGES) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const [min, max] = SETTINGS_NUMERIC_RANGES[key];
      (out as Record<string, number>)[key] = Math.min(max, Math.max(min, value));
    } else if (key === 'position' && typeof value === 'string' && VALID_POSITIONS.has(value)) {
      out.position = value as ViewPreset['position'];
    } else if ((key === 'shadow' || key === 'sharpen') && typeof value === 'boolean') {
      (out as Record<string, boolean>)[key] = value;
    } else if (key === 'outputFormat' && typeof value === 'string' && VALID_OUTPUT_FORMATS.has(value)) {
      out.outputFormat = value as ViewPreset['outputFormat'];
    }
    // unknown or wrong-typed keys are ignored
  }
  return out;
}
