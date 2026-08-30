"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Runnable self-check for productImageEditor.ts's pure math — no network
// call (editProductImage itself calls OpenAI and isn't exercised here),
// matching the codebase's selftest convention.
// Run: npx ts-node src/services/productImage/productImageEditor.selftest.ts (or `npm test`)
const assert_1 = __importDefault(require("assert"));
const productImageEditor_1 = require("./productImageEditor");
function parseSize(s) {
    const [w, h] = s.split("x").map(Number);
    return { w, h };
}
function main() {
    // computeEditSize matches the source's own aspect ratio (never forces a
    // square) so OpenAI edits the photo it was given instead of being asked
    // to fit content into a shape it wasn't given — this is the exact fix for
    // a live failure where a forced "1024x1024" square combined with a
    // composition-owning prompt produced a rotated, geometry-broken result.
    const portrait = parseSize((0, productImageEditor_1.computeEditSize)(3024, 4032));
    assert_1.default.ok(portrait.w % 16 === 0 && portrait.h % 16 === 0, "dimensions must be divisible by 16");
    assert_1.default.ok(portrait.h > portrait.w, "portrait source must stay portrait, not be forced square");
    assert_1.default.ok(Math.max(portrait.w, portrait.h) <= 1536, "must respect the max-dimension cap");
    const landscape = parseSize((0, productImageEditor_1.computeEditSize)(4032, 3024));
    assert_1.default.ok(landscape.w > landscape.h, "landscape source must stay landscape");
    const square = parseSize((0, productImageEditor_1.computeEditSize)(2000, 2000));
    assert_1.default.strictEqual(square.w, square.h, "a genuinely square source should stay square");
    const small = parseSize((0, productImageEditor_1.computeEditSize)(600, 400));
    assert_1.default.ok(small.w >= 512 && small.h >= 512, "must respect the min-dimension floor");
    const extreme = parseSize((0, productImageEditor_1.computeEditSize)(4000, 800)); // 5:1 source
    assert_1.default.ok(extreme.w / extreme.h <= 3, "must clamp to gpt-image-2's 1:3..3:1 aspect ratio limit");
    // orientationOf: the actual geometry-mismatch safety net's classification
    // — this is what catches "the laptop got rotated" without needing a
    // pixel-perfect comparison, just a category match.
    assert_1.default.strictEqual((0, productImageEditor_1.orientationOf)(4032, 3024), "landscape");
    assert_1.default.strictEqual((0, productImageEditor_1.orientationOf)(3024, 4032), "portrait");
    assert_1.default.strictEqual((0, productImageEditor_1.orientationOf)(2000, 2000), "square");
    assert_1.default.notStrictEqual((0, productImageEditor_1.orientationOf)(4032, 3024), (0, productImageEditor_1.orientationOf)(3024, 4032), "a rotated result must classify differently from its source");
    console.log("productImageEditor.selftest: all assertions passed");
}
main();
