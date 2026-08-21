"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// models/AbandonedCart.ts
const mongoose_1 = __importDefault(require("mongoose"));
const AbandonedCartSchema = new mongoose_1.default.Schema({
    isEnabled: {
        type: Boolean, // toggle ON / OFF
        default: true
    },
    timeGapMinutes: {
        type: Number, // delay before marking abandoned
        default: 30
    },
});
exports.default = mongoose_1.default.model("AbandonedCart", AbandonedCartSchema);
