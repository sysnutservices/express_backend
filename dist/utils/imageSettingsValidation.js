"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VALID_OUTPUT_FORMATS = exports.VALID_POSITIONS = exports.SETTINGS_NUMERIC_RANGES = void 0;
exports.parseSettingsField = parseSettingsField;
exports.sanitizeSettings = sanitizeSettings;
// Multipart fields arrive as strings — `settings` is sent as a JSON string
// when present (mirrors how `viewType` is just a plain field). Invalid JSON
// is treated as "no overrides" rather than a hard error, since composition
// overrides are optional.
function parseSettingsField(raw) {
    if (!raw)
        return undefined;
    if (typeof raw === 'object')
        return raw;
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch (_a) {
            return undefined;
        }
    }
    return undefined;
}
exports.SETTINGS_NUMERIC_RANGES = {
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
exports.VALID_POSITIONS = new Set([
    'center', 'center-top', 'center-bottom', 'left', 'right',
    'top-left', 'top-center', 'top-right', 'center-left', 'center-right',
    'bottom-left', 'bottom-center', 'bottom-right',
]);
exports.VALID_OUTPUT_FORMATS = new Set(['webp', 'jpeg', 'png']);
// Untrusted request input — every field is checked against a known type/range
// before being allowed through; anything invalid or unrecognized is silently
// dropped rather than passed on to Sharp.
function sanitizeSettings(raw) {
    const obj = parseSettingsField(raw);
    if (!obj)
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (key in exports.SETTINGS_NUMERIC_RANGES) {
            if (typeof value !== 'number' || !Number.isFinite(value))
                continue;
            const [min, max] = exports.SETTINGS_NUMERIC_RANGES[key];
            out[key] = Math.min(max, Math.max(min, value));
        }
        else if (key === 'position' && typeof value === 'string' && exports.VALID_POSITIONS.has(value)) {
            out.position = value;
        }
        else if ((key === 'shadow' || key === 'sharpen') && typeof value === 'boolean') {
            out[key] = value;
        }
        else if (key === 'outputFormat' && typeof value === 'string' && exports.VALID_OUTPUT_FORMATS.has(value)) {
            out.outputFormat = value;
        }
        // unknown or wrong-typed keys are ignored
    }
    return out;
}
