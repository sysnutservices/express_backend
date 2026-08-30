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
  computeOccupancy,
  flattenMasterToWhite,
  analyzeExposure,
  analyzeReflection,
  PROCESSING_CONFIG_VERSION,
} from "./imageProcessing";
import { computeProcessingHash, estimateCost, checkBudgetAndLimits, recordUsage } from "./imageCostControl";
import { removeBackgroundLocal } from "./localSegmentation";
import { classifyOpenAIError } from "./openaiClient";
import { editProductImage, GeometryMismatchError } from "./productImage/productImageEditor";
import { PRODUCT_IMAGE_PROMPT_VERSION } from "./productImage/productImagePrompts";

export type BrightnessMode = "auto" | "original"; // "manual" is just the caller explicitly setting settings.brightness/contrast — no separate mode value needed
// "auto" and "on" currently behave identically — both detect+flag, never a
// separate OpenAI call (see the note above the reflection check below for
// why "on" no longer triggers its own edit). Kept as three values rather
// than collapsing to a boolean so the API/UI contract from when this WAS a
// three-way distinction doesn't need to change again.
export type ReflectionMode = "off" | "auto" | "on";

// Two processing modes, chosen explicitly per request — never inferred:
//
// - "catalogue_safe" (the default): local segmentation (IS-Net) runs
//   directly on the ORIGINAL photo's own pixels — never on a generative
//   model's regenerated output. Only the alpha channel comes from the
//   model; every pixel inside the product silhouette is byte-identical to
//   the source photo, so product-pixel alteration is structurally
//   impossible, not just prompted against.
// - "ai_edit" (opt-in only): OpenAI performs one comprehensive edit (studio
//   background, cleanup, lighting, reflection reduction, composition —
//   see productImage/productImagePrompts.ts), then the SAME local
//   segmentation runs again on its output — never trusting OpenAI's own
//   transparency — purely to get a robust bbox/alpha for the catalogue
//   compositing step. This accepts the real risk that OpenAI alters product
//   pixels (confirmed repeatedly: an on-screen date changed 4 different ways
//   across generations despite increasingly strict preservation prompts).
//   Every result from either mode still requires manual approve/publish —
//   this mode never bypasses that.
export type ProcessingMode = "catalogue_safe" | "ai_edit";
export const DEFAULT_PROCESSING_MODE: ProcessingMode =
  process.env.IMAGE_PROCESSING_MODE === "ai_edit" ? "ai_edit" : "catalogue_safe";
const CATALOGUE_SAFE_METHOD = "local-segmentation-v1";
const MAX_AI_EDIT_ATTEMPTS = 3; // 1 initial + 2 retries, only for transient failures

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

// Composes an already-segmented cutout into the transparent master, the
// derived white-background master, and the 2000/1200/500 variants, then
// uploads them all — shared so the Sharp compositing logic exists exactly
// once (createEcommerceImage calls this at generation time; recomposeVersion
// calls it again against the same cached cutout for Sharp-only settings
// changes, never re-running the ~1-2s ML segmentation step).
//
// brightnessMode "auto" (the default) computes a conservative, capped
// brightness/contrast correction FROM THIS PHOTO'S OWN HISTOGRAM (see
// analyzeExposure) and uses it as the enhancement default — but only when
// the caller hasn't already set brightness/contrast explicitly (an admin
// manually moving the sliders always wins; that's "Manual" mode, and needs
// no separate code path). "original" skips this analysis entirely.
async function composeAndUpload(
  cutoutBuffer: Buffer,
  viewType: ProductViewType,
  settings: Partial<ViewPreset> | undefined,
  nameHintBase: string | undefined,
  brightnessMode: BrightnessMode = "auto"
) {
  let effectiveSettings = settings;
  if (brightnessMode === "auto" && settings?.brightness === undefined && settings?.contrast === undefined) {
    const exposure = await analyzeExposure(cutoutBuffer);
    if (exposure.needsCorrection) {
      effectiveSettings = { ...settings, brightness: exposure.brightness, contrast: exposure.contrast };
    }
  }
  const merged = resolveViewSettings(viewType, effectiveSettings);
  const studioSettings = viewPresetToStudioSettings(merged);

  // Transparent master first — the canonical artifact; the white ecommerce
  // version is a cheap flatten of THIS buffer, never a second independent
  // composite, so the two stay pixel-identical everywhere but the background.
  const transparentMaster = await composeStudioImage(cutoutBuffer, {
    ...studioSettings,
    background: "transparent",
    outputFormat: "png",
  });
  const masterBuffer = await flattenMasterToWhite(transparentMaster, studioSettings.outputFormat, studioSettings.quality);
  const qualityWarning = await validateMasterImage(masterBuffer);
  const occupancyPercent = await computeOccupancy(masterBuffer);
  const variants = await generateVariants(masterBuffer);

  const nameHint = [nameHintBase, viewType.replace(/_/g, " ")].filter(Boolean).join(" ") || "laptop";
  const [transparentUpload, masterUpload, productUpload, thumbnailUpload] = await Promise.all([
    uploadBufferToImageKit(transparentMaster, "/lapshark/products/transparent", `${nameHint} transparent`),
    uploadBufferToImageKit(variants.master.buffer, "/lapshark/products", nameHint),
    uploadBufferToImageKit(variants.product.buffer, "/lapshark/products/variants", `${nameHint} product`),
    uploadBufferToImageKit(variants.thumbnail.buffer, "/lapshark/products/variants", `${nameHint} thumbnail`),
  ]);
  return { merged, transparentUpload, masterUpload, productUpload, thumbnailUpload, qualityWarning, occupancyPercent };
}

export interface CreateEcommerceImageOptions {
  rootImageId: string;
  viewType: ProductViewType;
  settings?: Partial<ViewPreset>;
  initiatedBy: string | null;
  mode?: ProcessingMode;
  brightnessMode?: BrightnessMode;
  reflectionMode?: ReflectionMode;
}

// The one entry point for both "Create Ecommerce Image" and "Reprocess" —
// always reads from the root's original, never from a previous version, so
// "always reprocess from original" is structural, not a rule two separate
// code paths have to remember to follow.
export async function createEcommerceImage(opts: CreateEcommerceImageOptions): Promise<IProductImage> {
  const root = await loadRoot(opts.rootImageId);
  const mode: ProcessingMode = opts.mode === "ai_edit" ? "ai_edit" : "catalogue_safe";
  const promptVersion = mode === "ai_edit" ? PRODUCT_IMAGE_PROMPT_VERSION : CATALOGUE_SAFE_METHOD;

  const hash = computeProcessingHash({
    originalImageHash: root.originalImageHash!,
    viewType: opts.viewType,
    promptVersion,
    processingConfigVersion: PROCESSING_CONFIG_VERSION,
  });

  // Fingerprint reuse: identical original+viewType+mode+config was already
  // generated successfully — re-run only the Sharp step against the cached
  // cutout. Zero segmentation/OpenAI re-runs. Keyed on mode (via
  // promptVersion) so a catalogue_safe result is never mistaken for an
  // ai_edit one for the same viewType, or vice versa.
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
  // segmentation/OpenAI run — no queue system needed to dedupe in-flight work.
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
      promptVersion,
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
    const { buffer: originalBuffer, mimeType } = await fetchImageBytes(root.originalImageUrl!);

    let cutoutBuffer: Buffer;
    let processingModel: string;

    if (mode === "ai_edit") {
      // Explicit, admin-selected opt-in only (never the silent default) —
      // accepts the risk that OpenAI alters product pixels. Costs money, so
      // this is the only branch that budget-checks/records OpenAI usage.
      const budgetCheck = await checkBudgetAndLimits(estimateCost(null).amountUsd);
      if (!budgetCheck.allowed) {
        await ProductImage.updateOne({ _id: version._id }, { status: "PROCESSING_FAILED", rejectionReason: budgetCheck.reason });
        throw new OrchestratorError(budgetCheck.reason, budgetLimitMessage(budgetCheck.reason));
      }

      let edited: Awaited<ReturnType<typeof editProductImage>> | null = null;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= MAX_AI_EDIT_ATTEMPTS; attempt++) {
        const startedAt = Date.now();
        try {
          edited = await editProductImage(originalBuffer, mimeType, opts.viewType);
          const cost = estimateCost(edited.usage);
          await recordUsage({
            productId: root.productId,
            productImageId: root._id as Types.ObjectId,
            imageVersionId: version._id as Types.ObjectId,
            operation,
            aiModel: "gpt-image-2",
            originalImageHash: root.originalImageHash!,
            processingHash: hash,
            promptVersion,
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
          // A geometry mismatch (product got rotated/reoriented) is model
          // unpredictability on this one attempt, not invalid input or a
          // content-policy rejection — worth a retry, same budget as a
          // transient HTTP error.
          const isGeometryMismatch = err instanceof GeometryMismatchError;
          const classified = classifyOpenAIError(err);
          const transient = isGeometryMismatch || classified.transient;
          await recordUsage({
            productId: root.productId,
            productImageId: root._id as Types.ObjectId,
            imageVersionId: version._id as Types.ObjectId,
            operation,
            aiModel: "gpt-image-2",
            originalImageHash: root.originalImageHash!,
            processingHash: hash,
            promptVersion,
            processingConfigVersion: PROCESSING_CONFIG_VERSION,
            status: transient ? "error_transient" : "error_permanent",
            inputUsage: null,
            outputUsage: null,
            totalUsage: null,
            estimatedCost: null,
            estimatedCostIsApproximate: true,
            durationMs: Date.now() - startedAt,
            errorMessage: (isGeometryMismatch ? (err as Error).message : classified.message).slice(0, 500),
            initiatedBy: opts.initiatedBy ? (new Types.ObjectId(opts.initiatedBy) as any) : null,
          });
          if (!transient || attempt >= MAX_AI_EDIT_ATTEMPTS) break;
        }
      }

      if (!edited) {
        await ProductImage.updateOne({ _id: version._id }, { status: "PROCESSING_FAILED", rejectionReason: "AI image editing failed" });
        throw new OrchestratorError("OPENAI_FAILED", lastError instanceof Error ? lastError.message : "AI image editing failed");
      }

      // Even here, alpha/bbox comes from real segmentation of OpenAI's
      // output — OpenAI's own transparency (if any) is never trusted.
      cutoutBuffer = await removeBackgroundLocal(edited.buffer);
      processingModel = `gpt-image-2+local-segmentation (${edited.imageType})`;
    } else {
      // The whole point of the default mode: segmentation runs directly on
      // the ORIGINAL photo's own pixels, never on a generative model's
      // regenerated output.
      cutoutBuffer = await removeBackgroundLocal(originalBuffer);
      processingModel = "local-segmentation";
    }

    // Reflection: detection only, always local/free, never a second OpenAI
    // call. In ai_edit mode the comprehensive prompt already asks OpenAI to
    // reduce glare as part of its one edit (see productImagePrompts.ts), so
    // this just flags whatever's left over; in catalogue_safe there was
    // never a correction step to begin with — a local, safe, general-purpose
    // glare-removal algorithm isn't a solved problem, so this mode only ever
    // detects and flags for manual review.
    let reflectionNote: string | undefined;
    const reflectionMode: ReflectionMode = opts.reflectionMode ?? "auto";
    if (reflectionMode !== "off") {
      const reflection = await analyzeReflection(cutoutBuffer);
      if (reflection.detected) {
        reflectionNote =
          mode === "ai_edit"
            ? `Possible residual reflection/glare detected (~${reflection.hotspotPercent}% of frame) after AI editing — review closely`
            : `Possible reflection/glare detected (~${reflection.hotspotPercent}% of frame) — AI Edit mode attempts to reduce this, Catalogue Safe only flags it`;
      }
    }

    const cutoutUpload = await uploadBufferToImageKit(cutoutBuffer, "/lapshark/products/cutouts", `${opts.viewType} cutout`);
    const product = await Product.findById(root.productId).select("title").lean();
    const { merged, transparentUpload, masterUpload, productUpload, thumbnailUpload, qualityWarning, occupancyPercent } =
      await composeAndUpload(cutoutBuffer, opts.viewType, opts.settings, product?.title, opts.brightnessMode ?? "auto");

    await ProductImage.updateMany(
      { rootImageId: root._id, _id: { $ne: version._id }, isActive: true },
      { isActive: false }
    );

    version.status = "READY_FOR_REVIEW";
    version.qualityWarning = [qualityWarning, reflectionNote].filter(Boolean).join(" · ") || undefined;
    version.occupancyPercent = occupancyPercent;
    version.cutoutImageUrl = cutoutUpload.url;
    version.transparentMasterUrl = transparentUpload.url;
    version.masterImageUrl = masterUpload.url;
    version.productImageUrl = productUpload.url;
    version.thumbnailImageUrl = thumbnailUpload.url;
    version.processingModel = processingModel;
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

// Sharp-only recompute against the cached cutout — no segmentation re-run,
// no new version number. Used both for fingerprint reuse and for the
// settings panel's live preview.
export async function recomposeVersion(versionId: string, settings?: Partial<ViewPreset>): Promise<IProductImage> {
  const version = await ProductImage.findById(versionId);
  if (!version) throw new OrchestratorError("NOT_FOUND", "Image version not found");
  if (version.rootImageId === null) throw new OrchestratorError("NOT_A_ROOT", "Cannot recompose an original image slot");
  if (!version.cutoutImageUrl) {
    throw new OrchestratorError("NOT_RECOMPOSABLE", "This version has no cutout to recompose from yet");
  }

  const { buffer: cutoutBuffer } = await fetchImageBytes(version.cutoutImageUrl);
  const { merged, transparentUpload, masterUpload, productUpload, thumbnailUpload, qualityWarning, occupancyPercent } =
    await composeAndUpload(cutoutBuffer, version.viewType, settings, undefined);

  version.transparentMasterUrl = transparentUpload.url;
  version.masterImageUrl = masterUpload.url;
  version.productImageUrl = productUpload.url;
  version.thumbnailImageUrl = thumbnailUpload.url;
  version.processingSettings = merged as unknown as Record<string, unknown>;
  version.qualityWarning = qualityWarning ?? undefined;
  version.occupancyPercent = occupancyPercent;
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
