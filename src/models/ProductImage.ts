import mongoose, { Document, Schema, Types } from "mongoose";
import { ProductViewType } from "../services/imageProcessing";

// Admin-side source of truth for the AI image workflow (original -> AI
// versions -> approval -> publish). Deliberately separate from Product.image/
// images, which stay plain published URLs consumed by the storefront —
// publishing is the one operation that copies an approved version's URLs
// into those fields (see productImageOrchestrator.publishProductImages).
//
// One document per attempt: a doc with rootImageId=null IS the "slot" (the
// original + grouping anchor for one physical photo/angle); docs with
// rootImageId set are AI-generated versions under that slot. This avoids a
// second collection just to group versions under their original.
export type ImageStatus =
  | "UPLOADED"
  | "PROCESSING"
  | "READY_FOR_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "REJECTED"
  | "PROCESSING_FAILED"
  | "SUPERSEDED";

export const IMAGE_STATUS_VALUES: ImageStatus[] = [
  "UPLOADED", "PROCESSING", "READY_FOR_REVIEW", "APPROVED",
  "PUBLISHED", "REJECTED", "PROCESSING_FAILED", "SUPERSEDED",
];

export interface IProductImage extends Document {
  productId: Types.ObjectId;
  rootImageId: Types.ObjectId | null;

  viewType: ProductViewType;
  status: ImageStatus;
  version: number; // 0 = original/root; 1..n = real OpenAI generations only

  isActive: boolean;
  isApproved: boolean;
  isPublished: boolean;
  isPrimary: boolean; // meaningful on root docs only
  sortOrder: number; // meaningful on root docs only

  // Set on the root doc; denormalized onto every version under it so a
  // version can always be reprocessed without a join back to its root.
  originalImageUrl: string | null;
  originalImageHash: string | null;

  aiEditedImageUrl: string | null; // raw OpenAI output, cached for Sharp-only recompute
  masterImageUrl: string | null; // 2000x2000
  productImageUrl: string | null; // 1200x1200
  thumbnailImageUrl: string | null; // 500x500

  processingModel: string | null;
  processingSettings: Record<string, unknown> | null;
  processingHash: string | null;
  promptVersion: string | null;
  processingConfigVersion: string | null;

  rejectionReason?: string;
  // Set by a lightweight automated check right after composition (bad
  // dimensions/occupancy/background) — informational only, never blocks
  // approval, just flags the version for closer manual review.
  qualityWarning?: string;
  approvedAt?: Date;
  publishedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const ProductImageSchema: Schema<IProductImage> = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    rootImageId: { type: Schema.Types.ObjectId, ref: "ProductImage", default: null, index: true },

    viewType: { type: String, required: true, default: "custom" },
    status: { type: String, enum: IMAGE_STATUS_VALUES, required: true, default: "UPLOADED" },
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
    processingSettings: { type: Schema.Types.Mixed, default: null },
    processingHash: { type: String, default: null },
    promptVersion: { type: String, default: null },
    processingConfigVersion: { type: String, default: null },

    rejectionReason: { type: String },
    qualityWarning: { type: String },
    approvedAt: { type: Date },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

// Duplicate-click / duplicate-processing guard (no queue system exists to
// dedupe in-flight jobs otherwise): only one PROCESSING version per
// (root, fingerprint) can exist at a time. A second rapid click hits E11000
// instead of starting a second OpenAI call — see productImageOrchestrator.
ProductImageSchema.index(
  { rootImageId: 1, processingHash: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "PROCESSING" } }
);

export default mongoose.model<IProductImage>("ProductImage", ProductImageSchema);
