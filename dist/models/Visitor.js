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
const TouchSchema = {
    source: { type: String },
    medium: { type: String },
    campaign: { type: String },
    referrer: { type: String },
    landingPage: { type: String },
};
const VisitorSchema = new mongoose_1.Schema({
    visitorId: { type: String, required: true },
    userId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "User" },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    firstTouch: TouchSchema,
    lastTouch: TouchSchema,
    intentScore: { type: Number, default: 0 },
    intentLevel: {
        type: String,
        enum: ["cold", "warm", "hot", "customer"],
        default: "cold",
    },
    totalEvents: { type: Number, default: 0 },
}, { timestamps: true });
VisitorSchema.index({ visitorId: 1 }, { unique: true });
VisitorSchema.index({ userId: 1 });
// Powers the admin "sorted by intent" visitor list — an indexed sort, not
// an in-memory one, since this collection is expected to grow unbounded.
VisitorSchema.index({ intentScore: -1 });
VisitorSchema.index({ lastSeenAt: -1 });
exports.default = mongoose_1.default.model("Visitor", VisitorSchema);
