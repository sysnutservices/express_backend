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
// Runnable self-check for productImageTypes.ts — no network, no model
// inference, matching the codebase's selftest convention.
// Run: npx ts-node src/services/productImage/productImageTypes.selftest.ts (or `npm test`)
const assert_1 = __importDefault(require("assert"));
const sharp_1 = __importDefault(require("sharp"));
const productImageTypes_1 = require("./productImageTypes");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // 1. Non-open view types map straight to their category regardless of
        //    what's in the photo — no screen heuristic needed or run for them.
        const anyPhoto = yield (0, sharp_1.default)({ create: { width: 400, height: 400, channels: 3, background: "#808080" } }).png().toBuffer();
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("closed_top", anyPhoto), "CLOSED_LAPTOP_FRONT");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("closed_angle", anyPhoto), "CLOSED_LAPTOP_FRONT");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("closed_rear", anyPhoto), "CLOSED_LAPTOP_BACK");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("left_side", anyPhoto), "SIDE_VIEW");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("right_side", anyPhoto), "SIDE_VIEW");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("custom", anyPhoto), "OTHER_PRODUCT_VIEW");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("bottom", anyPhoto), "OTHER_PRODUCT_VIEW");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("ports", anyPhoto), "OTHER_PRODUCT_VIEW");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("detail", anyPhoto), "OTHER_PRODUCT_VIEW");
        // 2. open_front/open_angle disambiguate screen on/off from the upper-
        //    center region's brightness — a dark region reads as OFF, anything
        //    with real brightness reads as ON.
        const darkScreenPhoto = yield (0, sharp_1.default)({ create: { width: 400, height: 400, channels: 3, background: "#0a0a0a" } }).png().toBuffer();
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("open_front", darkScreenPhoto), "OPEN_LAPTOP_SCREEN_OFF");
        const litScreenPhoto = yield (0, sharp_1.default)({ create: { width: 400, height: 400, channels: 3, background: "#e0e0e0" } }).png().toBuffer();
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("open_front", litScreenPhoto), "OPEN_LAPTOP_SCREEN_ON");
        assert_1.default.strictEqual(yield (0, productImageTypes_1.detectImageType)("open_angle", litScreenPhoto), "OPEN_LAPTOP_SCREEN_ON");
        console.log("productImageTypes.selftest: all assertions passed");
    });
}
main().catch((err) => {
    console.error("productImageTypes.selftest FAILED:", err);
    process.exit(1);
});
