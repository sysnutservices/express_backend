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
exports.IMAGE_STATUS_VALUES = void 0;
const mongoose_1 = __importStar(require("mongoose"));
exports.IMAGE_STATUS_VALUES = [
    "UPLOADED", "PROCESSING", "READY_FOR_REVIEW", "APPROVED",
    "PUBLISHED", "REJECTED", "PROCESSING_FAILED", "SUPERSEDED",
];
const ProductImageSchema = new mongoose_1.Schema({
    productId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    rootImageId: { type: mongoose_1.Schema.Types.ObjectId, ref: "ProductImage", default: null, index: true },
    viewType: { type: String, required: true, default: "custom" },
    status: { type: String, enum: exports.IMAGE_STATUS_VALUES, required: true, default: "UPLOADED" },
    version: { type: Number, required: true, default: 0 },
    isActive: { type: Boolean, default: false },
    isApproved: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    isPrimary: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    originalImageUrl: { type: String, default: null },
    originalImageHash: { type: String, default: null },
    aiEditedImageUrl: { type: String, default: null },
    masterImageUrl: { type: String, default: null },
    productImageUrl: { type: String, default: null },
    thumbnailImageUrl: { type: String, default: null },
    processingModel: { type: String, default: null },
    processingSettings: { type: mongoose_1.Schema.Types.Mixed, default: null },
    processingHash: { type: String, default: null },
    promptVersion: { type: String, default: null },
    processingConfigVersion: { type: String, default: null },
    rejectionReason: { type: String },
    qualityWarning: { type: String },
    approvedAt: { type: Date },
    publishedAt: { type: Date },
}, { timestamps: true });
// Duplicate-click / duplicate-processing guard (no queue system exists to
// dedupe in-flight jobs otherwise): only one PROCESSING version per
// (root, fingerprint) can exist at a time. A second rapid click hits E11000
// instead of starting a second OpenAI call — see productImageOrchestrator.
ProductImageSchema.index({ rootImageId: 1, processingHash: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "PROCESSING" } });
exports.default = mongoose_1.default.model("ProductImage", ProductImageSchema);
