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
// Runnable self-check for imageProcessing.ts — no test framework, just
// assert(). Exercises pure math (scale/position/merge) plus a real Sharp
// round-trip (trim -> compose -> variants) against a synthetic transparent
// PNG, so it never calls the network (PhotoRoom).
//
// Run: npx ts-node src/services/imageProcessing.selftest.ts  (or `npm test`)
const assert_1 = __importDefault(require("assert"));
const sharp_1 = __importDefault(require("sharp"));
const imageProcessing_1 = require("./imageProcessing");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        // 1. View preset table has every documented angle.
        const expectedViews = [
            "open_front", "open_angle", "closed_top", "closed_angle", "bottom",
            "left_side", "right_side", "ports", "detail", "custom",
        ];
        for (const v of expectedViews) {
            assert_1.default.ok(imageProcessing_1.VIEW_PRESETS[v], `missing view preset: ${v}`);
            assert_1.default.ok(imageProcessing_1.VIEW_PRESETS[v].scale > 0 && imageProcessing_1.VIEW_PRESETS[v].scale <= 1, `${v} scale out of range`);
        }
        // 2. Scale calculation: spec's worked example (canvas 2000, scale 0.86 -> ~1720).
        assert_1.default.strictEqual((0, imageProcessing_1.computeTargetSize)(2000, 0.86), 1720);
        assert_1.default.strictEqual((0, imageProcessing_1.computeTargetSize)(2000, 1), 2000);
        // 3. Position calculation: center anchor centers exactly; center-bottom sits
        //    at the bottom edge before offset; offsets shift as expected; extreme
        //    offsets clamp to stay on-canvas.
        assert_1.default.deepStrictEqual((0, imageProcessing_1.computePosition)(2000, 2000, 1000, 1000, "center"), { left: 500, top: 500 });
        assert_1.default.deepStrictEqual((0, imageProcessing_1.computePosition)(2000, 2000, 1000, 1000, "center-bottom", 0, -20), { left: 500, top: 980 });
        assert_1.default.deepStrictEqual((0, imageProcessing_1.computePosition)(2000, 2000, 1000, 1000, "center", 0, 100000), { left: 500, top: 1000 });
        assert_1.default.deepStrictEqual((0, imageProcessing_1.computePosition)(2000, 2000, 1000, 1000, "center", 0, -100000), { left: 500, top: 0 });
        // 4. Settings merge priority: DEFAULT_ENHANCEMENT -> VIEW_PRESET -> manual, manual always wins.
        const preset = imageProcessing_1.VIEW_PRESETS.open_front;
        const manual = { scale: 0.5, brightness: 1.1 };
        const merged = Object.assign(Object.assign(Object.assign({}, imageProcessing_1.DEFAULT_ENHANCEMENT), preset), manual);
        assert_1.default.strictEqual(merged.scale, 0.5, "manual scale should win over preset");
        assert_1.default.strictEqual(merged.brightness, 1.1, "manual brightness should win over default");
        assert_1.default.strictEqual(merged.contrast, 1, "unset contrast should fall back to default");
        assert_1.default.strictEqual(merged.position, preset.position, "unset position should fall back to preset");
        // 5. End-to-end composite + variants on a synthetic cutout: non-square
        //    source (aspect ratio must be preserved), padded with transparent
        //    margin (must be trimmed before scaling).
        const productW = 400, productH = 200;
        const padding = 300;
        const cutout = yield (0, sharp_1.default)({
            create: {
                width: productW + padding * 2,
                height: productH + padding * 2,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
        })
            .composite([{
                input: yield (0, sharp_1.default)({ create: { width: productW, height: productH, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 255 } } }).png().toBuffer(),
                left: padding,
                top: padding,
            }])
            .png()
            .toBuffer();
        const settings = { canvasSize: 2000, scale: 0.86, position: "center", background: "#ffffff", shadow: false };
        const master = yield (0, imageProcessing_1.composeStudioImage)(cutout, settings);
        const masterMeta = yield (0, sharp_1.default)(master).metadata();
        assert_1.default.strictEqual(masterMeta.width, 2000, "master width must be exactly 2000");
        assert_1.default.strictEqual(masterMeta.height, 2000, "master height must be exactly 2000");
        // Aspect ratio preserved: the trimmed product was 2:1, so within the
        // composited master the visible (non-white) bounding box should still be ~2:1.
        const flattenedBack = yield (0, sharp_1.default)(master).flatten({ background: "#ffffff" }).toBuffer();
        const trimmedBuffer = yield (0, sharp_1.default)(flattenedBack).trim({ background: "#ffffff" }).toBuffer();
        const trimmedBack = yield (0, sharp_1.default)(trimmedBuffer).metadata();
        const ratio = ((_a = trimmedBack.width) !== null && _a !== void 0 ? _a : 0) / ((_b = trimmedBack.height) !== null && _b !== void 0 ? _b : 1);
        assert_1.default.ok(Math.abs(ratio - 2) < 0.15, `aspect ratio not preserved: got ${ratio}`);
        const variants = yield (0, imageProcessing_1.generateVariants)(master);
        assert_1.default.strictEqual(variants.master.width, 2000);
        assert_1.default.strictEqual(variants.product.width, 1200);
        assert_1.default.strictEqual(variants.product.height, 1200);
        assert_1.default.strictEqual(variants.thumbnail.width, 500);
        assert_1.default.strictEqual(variants.thumbnail.height, 500);
        const productMeta = yield (0, sharp_1.default)(variants.product.buffer).metadata();
        assert_1.default.strictEqual(productMeta.width, 1200);
        const thumbMeta = yield (0, sharp_1.default)(variants.thumbnail.buffer).metadata();
        assert_1.default.strictEqual(thumbMeta.width, 500);
        // 6. validateMasterImage: a well-formed master (this one — proper size,
        //    real occupancy, clean white corners) passes clean; synthetic
        //    obviously-broken masters get flagged instead of silently approved.
        assert_1.default.strictEqual(yield (0, imageProcessing_1.validateMasterImage)(master), null, "a valid master must not be flagged");
        const wrongSize = yield (0, sharp_1.default)({ create: { width: 1000, height: 1000, channels: 3, background: "#ffffff" } }).png().toBuffer();
        assert_1.default.ok((_c = (yield (0, imageProcessing_1.validateMasterImage)(wrongSize))) === null || _c === void 0 ? void 0 : _c.includes("dimensions"), "wrong dimensions must be flagged");
        const tinyProduct = yield (0, sharp_1.default)({ create: { width: 2000, height: 2000, channels: 3, background: "#ffffff" } })
            .composite([{ input: yield (0, sharp_1.default)({ create: { width: 40, height: 40, channels: 3, background: "#000000" } }).png().toBuffer(), left: 980, top: 980 }])
            .png()
            .toBuffer();
        assert_1.default.ok((_d = (yield (0, imageProcessing_1.validateMasterImage)(tinyProduct))) === null || _d === void 0 ? void 0 : _d.includes("whitespace"), "a near-empty frame must be flagged");
        const offWhiteBg = yield (0, sharp_1.default)({ create: { width: 2000, height: 2000, channels: 3, background: "#e0e0e0" } })
            .composite([{ input: yield (0, sharp_1.default)({ create: { width: 1600, height: 1600, channels: 3, background: "#000000" } }).png().toBuffer(), left: 200, top: 200 }])
            .png()
            .toBuffer();
        assert_1.default.ok((_e = (yield (0, imageProcessing_1.validateMasterImage)(offWhiteBg))) === null || _e === void 0 ? void 0 : _e.includes("white"), "a non-white background corner must be flagged");
        console.log("imageProcessing.selftest: all assertions passed");
    });
}
main().catch((err) => {
    console.error("imageProcessing.selftest FAILED:", err);
    process.exit(1);
});
