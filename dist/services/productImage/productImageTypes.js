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
exports.detectImageType = detectImageType;
const sharp_1 = __importDefault(require("sharp"));
// Base category per admin-selected view type — everything not open/closed/
// side/closeup falls back to OTHER_PRODUCT_VIEW rather than being forced
// into a category it doesn't belong to.
const VIEW_TYPE_TO_BASE = {
    open_front: "OPEN_LAPTOP",
    open_angle: "OPEN_LAPTOP",
    closed_top: "CLOSED_LAPTOP_FRONT",
    closed_angle: "CLOSED_LAPTOP_FRONT",
    closed_rear: "CLOSED_LAPTOP_BACK",
    bottom: "OTHER_PRODUCT_VIEW",
    left_side: "SIDE_VIEW",
    right_side: "SIDE_VIEW",
    ports: "OTHER_PRODUCT_VIEW",
    detail: "OTHER_PRODUCT_VIEW",
    custom: "OTHER_PRODUCT_VIEW",
};
// Rough, cheap on/off signal — NOT a real vision classifier. Samples the
// upper-center region of the frame (where an open laptop's screen sits in
// every one of the view types that reach here) and checks whether it's
// dark (screen off) or has real brightness/variance (screen on, showing a
// desktop/wallpaper/lock screen). A genuinely reliable classifier would need
// the segmented product mask or a vision model call; this heuristic runs on
// the raw original before any segmentation, so it stays a coarse signal —
// good enough to pick between two prompt variants, not a guarantee.
const SCREEN_OFF_MEAN_THRESHOLD = 45;
function detectScreenState(originalBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const meta = yield (0, sharp_1.default)(originalBuffer).metadata();
            if (!meta.width || !meta.height)
                return "unknown";
            const region = yield (0, sharp_1.default)(originalBuffer)
                .extract({
                left: Math.round(meta.width * 0.3),
                top: Math.round(meta.height * 0.15),
                width: Math.round(meta.width * 0.4),
                height: Math.round(meta.height * 0.35),
            })
                .stats();
            const mean = region.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
            return mean < SCREEN_OFF_MEAN_THRESHOLD ? "off" : "on";
        }
        catch (_a) {
            return "unknown";
        }
    });
}
// Called once per ai_edit attempt, before the OpenAI request is built, so
// the prompt can adapt to what's actually in the photo instead of forcing
// every open-laptop shot into one assumption.
function detectImageType(viewType, originalBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const base = (_a = VIEW_TYPE_TO_BASE[viewType]) !== null && _a !== void 0 ? _a : "OTHER_PRODUCT_VIEW";
        if (base !== "OPEN_LAPTOP")
            return base;
        const screenState = yield detectScreenState(originalBuffer);
        return screenState === "off" ? "OPEN_LAPTOP_SCREEN_OFF" : "OPEN_LAPTOP_SCREEN_ON";
    });
}
