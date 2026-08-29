import mongoose, { Document, Schema, Types } from "mongoose";

// One row per OpenAI attempt (success or failure) — never per Sharp/ImageKit
// step, since those cost nothing and don't need auditing. Backs the admin
// usage dashboard and the monthly/daily/hourly budget checks in
// imageCostControl.ts. Never stores API keys.
export interface IImageProcessingUsage extends Document {
  // Both null for the legacy pre-product-creation endpoint (POST
  // /products/process-image), which runs before any Product/ProductImage
  // document exists yet — still recorded so it counts toward the
  // budget/rate limits, just not attributable to a specific product.
  productId: Types.ObjectId | null;
  productImageId: Types.ObjectId | null; // the root/slot id
  imageVersionId: Types.ObjectId | null; // null if the attempt failed before a version doc existed

  operation: "create" | "reprocess";
  aiModel: string; // named aiModel, not model — Document already has a .model() method

  originalImageHash: string | null;
  processingHash: string | null;
  promptVersion: string | null;
  processingConfigVersion: string | null;

  status: "success" | "error_transient" | "error_permanent";

  inputUsage: Record<string, unknown> | null; // raw OpenAI usage, stored as-is (shape not guessed)
  outputUsage: Record<string, unknown> | null;
  totalUsage: Record<string, unknown> | null;

  estimatedCost: number | null;
  estimatedCostIsApproximate: boolean;

  durationMs: number;
  errorMessage?: string; // sanitized only, never a raw stack/provider secret

  initiatedBy: Types.ObjectId | null; // req.user._id, for audit

  createdAt: Date;
}

const ImageProcessingUsageSchema: Schema<IImageProcessingUsage> = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null, index: true },
    productImageId: { type: Schema.Types.ObjectId, ref: "ProductImage", default: null },
    imageVersionId: { type: Schema.Types.ObjectId, ref: "ProductImage", default: null },

    operation: { type: String, enum: ["create", "reprocess"], required: true },
    aiModel: { type: String, required: true },

    originalImageHash: { type: String, default: null },
    processingHash: { type: String, default: null },
    promptVersion: { type: String, default: null },
    processingConfigVersion: { type: String, default: null },

    status: { type: String, enum: ["success", "error_transient", "error_permanent"], required: true },

    inputUsage: { type: Schema.Types.Mixed, default: null },
    outputUsage: { type: Schema.Types.Mixed, default: null },
    totalUsage: { type: Schema.Types.Mixed, default: null },

    estimatedCost: { type: Number, default: null },
    estimatedCostIsApproximate: { type: Boolean, default: true },

    durationMs: { type: Number, required: true },
    errorMessage: { type: String },

    initiatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ImageProcessingUsageSchema.index({ createdAt: 1 });

export default mongoose.model<IImageProcessingUsage>("ImageProcessingUsage", ImageProcessingUsageSchema);
