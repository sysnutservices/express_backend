"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const BehaviorEventSchema = new mongoose_1.Schema({
    eventName: { type: String, required: true },
    visitorId: { type: String, default: null },
    sessionId: { type: String, default: null },
    userId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
    // Loosely-typed whitelisted bag, same convention as Order.ts's
    // storage/warranty/selectedConfig fields (Object, not Schema.Types.Mixed).
    properties: { type: Object, default: {} },
    page: {
        url: { type: String },
        path: { type: String },
        title: { type: String },
    },
    source: { type: String, enum: ["client", "server"], required: true },
}, { timestamps: true });
// Journey timeline query (one visitor's full chronological history).
BehaviorEventSchema.index({ visitorId: 1, createdAt: -1 });
// Funnel aggregation query (counts per event name over a date range).
BehaviorEventSchema.index({ eventName: 1, createdAt: -1 });
BehaviorEventSchema.index({ userId: 1, createdAt: -1 });
exports.default = mongoose_1.default.model("BehaviorEvent", BehaviorEventSchema);
