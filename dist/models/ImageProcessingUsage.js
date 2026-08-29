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
const ImageProcessingUsageSchema = new mongoose_1.Schema({
    productId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Product", default: null, index: true },
    productImageId: { type: mongoose_1.Schema.Types.ObjectId, ref: "ProductImage", default: null },
    imageVersionId: { type: mongoose_1.Schema.Types.ObjectId, ref: "ProductImage", default: null },
    operation: { type: String, enum: ["create", "reprocess"], required: true },
    aiModel: { type: String, required: true },
    originalImageHash: { type: String, default: null },
    processingHash: { type: String, default: null },
    promptVersion: { type: String, default: null },
    processingConfigVersion: { type: String, default: null },
    status: { type: String, enum: ["success", "error_transient", "error_permanent"], required: true },
    inputUsage: { type: mongoose_1.Schema.Types.Mixed, default: null },
    outputUsage: { type: mongoose_1.Schema.Types.Mixed, default: null },
    totalUsage: { type: mongoose_1.Schema.Types.Mixed, default: null },
    estimatedCost: { type: Number, default: null },
    estimatedCostIsApproximate: { type: Boolean, default: true },
    durationMs: { type: Number, required: true },
    errorMessage: { type: String },
    initiatedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });
ImageProcessingUsageSchema.index({ createdAt: 1 });
exports.default = mongoose_1.default.model("ImageProcessingUsage", ImageProcessingUsageSchema);
