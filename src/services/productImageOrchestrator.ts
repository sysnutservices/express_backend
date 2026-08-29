import { Types } from "mongoose";
import ProductImage, { IProductImage } from "../models/ProductImage";
import Product from "../models/Product";
import { uploadBufferToImageKit } from "../services/imagekit";
import {
  ProductViewType,
  ViewPreset,
  composeStudioImage,
  generateVariants,
  resolveViewSettings,
  viewPresetToStudioSettings,
  validateMasterImage,
  PROCESSING_CONFIG_VERSION,
} from "./imageProcessing";
import { buildLapsharkImagePrompt, generateEcommerceEdit, classifyOpenAIError, IMAGE_PROMPT_VERSION } from "./openaiImageService";
import { computeProcessingHash, estimateCost, checkBudgetAndLimits, recordUsage } from "./imageCostControl";
import { removeBackgroundLocal } from "./localSegmentation";

// OpenAI GPT Image 2 is the sole *background/presentation* editor, by
// explicit decision — full local-segmentation-as-the-default was tried and
// benchmarked, then reverted in favor of OpenAI, accepting that it can
// alter product pixels (confirmed: an on-screen date changed 3 times
// despite preservation prompts). What's NOT reverted is using
// localSegmentation.ts's IS-Net model for what it's actually good at and
// doesn't touch product pixels for: finding a tight, robust product
// bounding box on OpenAI's output. OpenAI edits the background; Sharp,
// guided by that bbox, decides 100% of the geometry (crop/scale/position) —
// OpenAI was never a reliable judge of "how much whitespace is too much."

export const MAX_ATTEMPTS = 3; // 1 initial + 2 retries, only for transient failures

export type OrchestratorErrorCode =
  | "NOT_FOUND"
  | "NOT_A_ROOT"
  | "NO_ORIGINAL"
  | "AI_DISABLED"
  | "MONTHLY_BUDGET"
  | "DAILY_LIMIT"
  | "HOURLY_LIMIT"
  | "OPENAI_FAILED"
  | "INVALID_OUTPUT"
  | "NOT_RECOMPOSABLE"
  | "NOTHING_APPROVED";

export class OrchestratorError extends Error {
  code: OrchestratorErrorCode;
  constructor(code: OrchestratorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

async function fetchImageBytes(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new OrchestratorError("NO_ORIGINAL", `Could not fetch source image (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  return { buffer, mimeType };
}

async function loadRoot(rootImageId: string): Promise<IProductImage> {
  const root = await ProductImage.findById(rootImageId);
  if (!root) throw new OrchestratorError("NOT_FOUND", "Image not found");
  if (root.rootImageId !== null) throw new OrchestratorError("NOT_A_ROOT", "Not an original image slot");
  if (!root.originalImageUrl || !root.originalImageHash) {
    throw new OrchestratorError("NO_ORIGINAL", "This image has no stored original and cannot be (re)processed");
  }
  return root;
}

async function nextVersionNumber(rootId: Types.ObjectId): Promise<number> {
  const lastVersion = await ProductImage.findOne({ rootImageId: rootId }).sort({ version: -1 });
  return (lastVersion?.version ?? 0) + 1;
}

// Composes an already-cropped cutout into the 2000/1200/500 variants and
// uploads them — shared so the Sharp compositing logic exists exactly once.
// Takes a cutout, not the raw OpenAI output — the caller runs
// removeBackgroundLocal (IS-Net bbox/crop) ONCE at generation time and
// caches the result as aiEditedImageUrl, rather than this function
// re-running ~1-2s of ML inference on every Sharp-only settings recompute
// (recomposeVersion calls this same path for the live-preview debounce,
// which needs to stay fast).
async function composeAndUpload(
  cutoutBuffer: Buffer,
  viewType: ProductViewType,
  settings: Partial<ViewPreset> | undefined,
  nameHintBase: string | undefined
) {
  const merged = resolveViewSettings(viewType, settings);
  const studioSettings = viewPresetToStudioSettings(merged);
  const masterBuffer = await composeStudioImage(cutoutBuffer, studioSettings);
  const qualityWarning = await validateMasterImage(masterBuffer);
  const variants = await generateVariants(masterBuffer);

  const nameHint = [nameHintBase, viewType.replace(/_/g, " ")].filter(Boolean).join(" ") || "laptop";
  const [masterUpload, productUpload, thumbnailUpload] = await Promise.all([
    uploadBufferToImageKit(variants.master.buffer, "/lapshark/products", nameHint),
    uploadBufferToImageKit(variants.product.buffer, "/lapshark/products/variants", `${nameHint} product`),
    uploadBufferToImageKit(variants.thumbnail.buffer, "/lapshark/products/variants", `${nameHint} thumbnail`),
  ]);
  return { merged, masterUpload, productUpload, thumbnailUpload, qualityWarning };
}

export interface CreateEcommerceImageOptions {
  rootImageId: string;
  viewType: ProductViewType;
  settings?: Partial<ViewPreset>;
  initiatedBy: string | null;
}

// The one entry point for both "Create Ecommerce Image" and "Reprocess" —
// always reads from the root's original, never from a previous version, so
// "always reprocess from original" is structural, not a rule two separate
// code paths have to remember to follow.
export async function createEcommerceImage(opts: CreateEcommerceImageOptions): Promise<IProductImage> {
  const root = await loadRoot(opts.rootImageId);

  const hash = computeProcessingHash({
    originalImageHash: root.originalImageHash!,
    viewType: opts.viewType,
    promptVersion: IMAGE_PROMPT_VERSION,
    processingConfigVersion: PROCESSING_CONFIG_VERSION,
  });

  // Fingerprint reuse: identical original+viewType+prompt+config was already
  // generated successfully — re-run only the Sharp step against the cached
  // AI output. Zero OpenAI calls.
  const reusable = await ProductImage.findOne({
    rootImageId: root._id,
    processingHash: hash,
    status: { $in: ["READY_FOR_REVIEW", "APPROVED", "PUBLISHED"] },
  }).sort({ createdAt: -1 });
  if (reusable) {
    return recomposeVersion(String(reusable._id), opts.settings);
  }

  const versionNumber = await nextVersionNumber(root._id as Types.ObjectId);
  const operation: "create" | "reprocess" = versionNumber === 1 ? "create" : "reprocess";

  // Idempotency / duplicate-click guard: the partial unique index on
  // {rootImageId, processingHash, status:"PROCESSING"} makes a second rapid
  // click for the same fingerprint hit E11000 instead of starting a second
  // OpenAI call — no queue system needed to dedupe in-flight work.
  let version: IProductImage;
  try {
    version = await ProductImage.create({
      productId: root.productId,
      rootImageId: root._id,
      viewType: opts.viewType,
      status: "PROCESSING",
      version: versionNumber,
      originalImageUrl: root.originalImageUrl,
      originalImageHash: root.originalImageHash,
      processingHash: hash,
      promptVersion: IMAGE_PROMPT_VERSION,
      processingConfigVersion: PROCESSING_CONFIG_VERSION,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const inFlight = await ProductImage.findOne({ rootImageId: root._id, processingHash: hash, status: "PROCESSING" });
      if (inFlight) return inFlight;
    }
    throw err;
  }

  try {
    const budgetCheck = await checkBudgetAndLimits(estimateCost(null).amountUsd);
    if (!budgetCheck.allowed) {
      await ProductImage.updateOne({ _id: version._id }, { status: "PROCESSING_FAILED", rejectionReason: budgetCheck.reason });
      throw new OrchestratorError(budgetCheck.reason, budgetLimitMessage(budgetCheck.reason));
    }

    const { buffer: originalBuffer, mimeType } = await fetchImageBytes(root.originalImageUrl!);
    const prompt = buildLapsharkImagePrompt({ viewType: opts.viewType });

    let edited: Awaited<ReturnType<typeof generateEcommerceEdit>> | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const startedAt = Date.now();
      try {
        edited = await generateEcommerceEdit(originalBuffer, mimeType, prompt);
        const cost = estimateCost(edited.usage);
        await recordUsage({
          productId: root.productId,
          productImageId: root._id as Types.ObjectId,
          imageVersionId: version._id as Types.ObjectId,
          operation,
          aiModel: "gpt-image-2",
          originalImageHash: root.originalImageHash!,
          processingHash: hash,
          promptVersion: IMAGE_PROMPT_VERSION,
          processingConfigVersion: PROCESSING_CONFIG_VERSION,
          status: "success",
          inputUsage: edited.usage,
          outputUsage: edited.usage,
          totalUsage: edited.usage,
          estimatedCost: cost.amountUsd,
          estimatedCostIsApproximate: cost.approximate,
          durationMs: Date.now() - startedAt,
          initiatedBy: opts.initiatedBy ? (new Types.ObjectId(opts.initiatedBy) as any) : null,
        });
        break;
      } catch (err) {
        lastError = err;
        const classified = classifyOpenAIError(err);
        await recordUsage({
          productId: root.productId,
          productImageId: root._id as Types.ObjectId,
          imageVersionId: version._id as Types.ObjectId,
          operation,
          aiModel: "gpt-image-2",
          originalImageHash: root.originalImageHash!,
          processingHash: hash,
          promptVersion: IMAGE_PROMPT_VERSION,
          processingConfigVersion: PROCESSING_CONFIG_VERSION,
          status: classified.transient ? "error_transient" : "error_permanent",
          inputUsage: null,
          outputUsage: null,
          totalUsage: null,
          estimatedCost: null,
          estimatedCostIsApproximate: true,
          durationMs: Date.now() - startedAt,
          errorMessage: classified.message.slice(0, 500),
          initiatedBy: opts.initiatedBy ? (new Types.ObjectId(opts.initiatedBy) as any) : null,
        });
        if (!classified.transient || attempt >= MAX_ATTEMPTS) break;
      }
    }

    if (!edited) {
      await ProductImage.updateOne({ _id: version._id }, { status: "PROCESSING_FAILED", rejectionReason: "AI image editing failed" });
      throw new OrchestratorError("OPENAI_FAILED", lastError instanceof Error ? lastError.message : "AI image editing failed");
    }

    // Crop to the product's real bounding box ONCE here (IS-Net, same model
    // as the deterministic pipeline, used only for a robust bbox — it never
    // replaces or blends product pixels here, composeStudioImage still
    // flattens onto white below). Cached as aiEditedImageUrl so later
    // Sharp-only settings changes (recomposeVersion) don't re-run inference.
    const cutoutBuffer = await removeBackgroundLocal(edited.buffer);
    const aiUpload = await uploadBufferToImageKit(cutoutBuffer, "/lapshark/products/ai-edited", `${opts.viewType} ai-edit`);
    const product = await Product.findById(root.productId).select("title").lean();
    const { merged, masterUpload, productUpload, thumbnailUpload, qualityWarning } = await composeAndUpload(
      cutoutBuffer,
      opts.viewType,
      opts.settings,
      product?.title
    );

    await ProductImage.updateMany(
      { rootImageId: root._id, _id: { $ne: version._id }, isActive: true },
      { isActive: false }
    );

    version.status = "READY_FOR_REVIEW";
    version.qualityWarning = qualityWarning ?? undefined;
    version.aiEditedImageUrl = aiUpload.url;
    version.masterImageUrl = masterUpload.url;
    version.productImageUrl = productUpload.url;
    version.thumbnailImageUrl = thumbnailUpload.url;
    version.processingModel = "gpt-image-2";
    version.processingSettings = merged as unknown as Record<string, unknown>;
    version.isActive = true;
    await version.save();
    return version;
  } catch (err) {
    if (err instanceof OrchestratorError) throw err;
    await ProductImage.updateOne(
      { _id: version._id, status: "PROCESSING" },
      { status: "PROCESSING_FAILED", rejectionReason: err instanceof Error ? err.message.slice(0, 500) : "Processing failed" }
    );
    throw err;
  }
}

export function budgetLimitMessage(reason: OrchestratorErrorCode): string {
  switch (reason) {
    case "AI_DISABLED":
      return "AI image processing is temporarily disabled.";
    case "MONTHLY_BUDGET":
      return "Monthly image processing budget has been reached.";
    case "DAILY_LIMIT":
      return "Daily image processing limit reached, try again later.";
    case "HOURLY_LIMIT":
      return "Hourly image processing limit reached, try again later.";
    default:
      return "Image processing is currently unavailable.";
  }
}

// Sharp-only recompute against the cached AI output — no OpenAI call, no new
// version number. Used both for fingerprint reuse and for the settings
// panel's live preview.
export async function recomposeVersion(versionId: string, settings?: Partial<ViewPreset>): Promise<IProductImage> {
  const version = await ProductImage.findById(versionId);
  if (!version) throw new OrchestratorError("NOT_FOUND", "Image version not found");
  if (version.rootImageId === null) throw new OrchestratorError("NOT_A_ROOT", "Cannot recompose an original image slot");
  if (!version.aiEditedImageUrl) {
    throw new OrchestratorError("NOT_RECOMPOSABLE", "This version has no AI output to recompose from yet");
  }

  const { buffer: editedBuffer } = await fetchImageBytes(version.aiEditedImageUrl);
  const merged = resolveViewSettings(version.viewType, settings);
  const studioSettings = viewPresetToStudioSettings(merged);
  const masterBuffer = await composeStudioImage(editedBuffer, studioSettings);
  const qualityWarning = await validateMasterImage(masterBuffer);
  const variants = await generateVariants(masterBuffer);

  const nameHint = version.viewType.replace(/_/g, " ");
  const [masterUpload, productUpload, thumbnailUpload] = await Promise.all([
    uploadBufferToImageKit(variants.master.buffer, "/lapshark/products", nameHint),
    uploadBufferToImageKit(variants.product.buffer, "/lapshark/products/variants", `${nameHint} product`),
    uploadBufferToImageKit(variants.thumbnail.buffer, "/lapshark/products/variants", `${nameHint} thumbnail`),
  ]);

  version.masterImageUrl = masterUpload.url;
  version.productImageUrl = productUpload.url;
  version.thumbnailImageUrl = thumbnailUpload.url;
  version.processingSettings = merged as unknown as Record<string, unknown>;
  version.qualityWarning = qualityWarning ?? undefined;
  if (version.status === "PROCESSING_FAILED") version.status = "READY_FOR_REVIEW";
  await version.save();
  return version;
}

// Publishing reads only already-approved versions and never calls OpenAI —
// copies their URLs into Product.image/images, exactly mirroring how
// createProduct/updateProduct already accept pre-processed URLs today.
export async function publishProductImages(productId: string): Promise<{ image: string; images: string[] }> {
  const roots = await ProductImage.find({ productId, rootImageId: null }).sort({ sortOrder: 1 });
  if (roots.length === 0) throw new OrchestratorError("NOTHING_APPROVED", "No images to publish");

  const slots: { root: IProductImage; approved: IProductImage }[] = [];
  for (const root of roots) {
    const approved = await ProductImage.findOne({ rootImageId: root._id, status: "APPROVED" });
    if (approved) slots.push({ root, approved });
  }
  if (slots.length === 0) throw new OrchestratorError("NOTHING_APPROVED", "No approved images to publish");

  const primaryIndex = Math.max(0, slots.findIndex((s) => s.root.isPrimary));
  const primary = slots[primaryIndex];
  const rest = slots.filter((_, i) => i !== primaryIndex);

  const image = primary.approved.masterImageUrl!;
  const images = rest.map((s) => s.approved.masterImageUrl!).filter(Boolean) as string[];

  const now = new Date();
  for (const { root, approved } of slots) {
    // Supersede any prior PUBLISHED version under this root — never deleted.
    await ProductImage.updateMany(
      { rootImageId: root._id, status: "PUBLISHED", _id: { $ne: approved._id } },
      { status: "SUPERSEDED", isPublished: false }
    );
    approved.status = "PUBLISHED";
    approved.isPublished = true;
    approved.publishedAt = now;
    await approved.save();
  }

  await Product.updateOne({ _id: productId }, { image, images });
  return { image, images };
}
