import crypto from "crypto";
import ImageProcessingUsage, { IImageProcessingUsage } from "../models/ImageProcessingUsage";
import Product from "../models/Product";
import { AI_IMAGE_CONFIG, OPENAI_IMAGE_PRICING } from "../config/aiImageConfig";
import { ProductViewType } from "./imageProcessing";

// sha256 over stable-joined fields — same hashing convention as
// metaCapi.ts's sha256() helper, no new dependency.
export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hashImageBuffer(buffer: Buffer): string {
  return sha256(buffer.toString("base64"));
}

export interface ProcessingHashInput {
  originalImageHash: string;
  viewType: ProductViewType;
  promptVersion: string;
  processingConfigVersion: string;
}

// Deliberately excludes every composition-only field (scale, position,
// offsets, shadow, canvas size, background, output format, quality) — those
// are Sharp-only per Phase 25A #4 and must never trigger a re-generation.
export function computeProcessingHash(input: ProcessingHashInput): string {
  return sha256(
    [input.originalImageHash, input.viewType, input.promptVersion, input.processingConfigVersion].join("|")
  );
}

export interface CostEstimate {
  amountUsd: number | null;
  approximate: boolean;
}

// Never invents a number: if OpenAI didn't return usable usage and no
// pricing env var is configured, cost is null/approximate rather than a
// guess (Phase 25A #15).
export function estimateCost(usage: Record<string, unknown> | null): CostEstimate {
  const inputRate = OPENAI_IMAGE_PRICING.inputCostPer1kUnits();
  const outputRate = OPENAI_IMAGE_PRICING.outputCostPer1kUnits();

  if (usage && (inputRate !== null || outputRate !== null)) {
    const inputTokens = Number(usage.input_tokens ?? 0);
    const outputTokens = Number(usage.output_tokens ?? 0);
    const amount = (inputTokens / 1000) * (inputRate ?? 0) + (outputTokens / 1000) * (outputRate ?? 0);
    if (Number.isFinite(amount) && amount > 0) return { amountUsd: amount, approximate: false };
  }

  const flat = OPENAI_IMAGE_PRICING.flatCostPerCallUsd();
  if (flat !== null) return { amountUsd: flat, approximate: true };

  return { amountUsd: null, approximate: true };
}

export function isAiProcessingEnabled(): boolean {
  return AI_IMAGE_CONFIG.enabled();
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfHour(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
}

async function sumCostSince(date: Date): Promise<number> {
  const rows = await ImageProcessingUsage.aggregate([
    { $match: { createdAt: { $gte: date } } },
    { $group: { _id: null, total: { $sum: { $ifNull: ["$estimatedCost", 0] } } } },
  ]);
  return rows[0]?.total ?? 0;
}

async function countSince(date: Date): Promise<number> {
  return ImageProcessingUsage.countDocuments({ createdAt: { $gte: date } });
}

export type BudgetCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "AI_DISABLED" | "MONTHLY_BUDGET" | "DAILY_LIMIT" | "HOURLY_LIMIT" };

// Run BEFORE calling OpenAI. Sums money already spent this month/day/hour —
// including failed attempts, since a failed call still cost money — and
// blocks before a new call would push past a configured cap. Unset limits
// mean "no cap enforced", never a fabricated default.
export async function checkBudgetAndLimits(estimatedNextCostUsd: number | null): Promise<BudgetCheckResult> {
  if (!isAiProcessingEnabled()) return { allowed: false, reason: "AI_DISABLED" };

  const monthlyBudget = AI_IMAGE_CONFIG.monthlyBudgetUsd();
  if (monthlyBudget !== null) {
    const spent = await sumCostSince(startOfMonth());
    if (spent + (estimatedNextCostUsd ?? 0) > monthlyBudget) {
      return { allowed: false, reason: "MONTHLY_BUDGET" };
    }
  }

  const dailyLimit = AI_IMAGE_CONFIG.dailyLimit();
  if (dailyLimit !== null) {
    const count = await countSince(startOfDay());
    if (count >= dailyLimit) return { allowed: false, reason: "DAILY_LIMIT" };
  }

  const hourlyLimit = AI_IMAGE_CONFIG.hourlyLimit();
  if (hourlyLimit !== null) {
    const count = await countSince(startOfHour());
    if (count >= hourlyLimit) return { allowed: false, reason: "HOURLY_LIMIT" };
  }

  return { allowed: true };
}

export interface NewUsageEntry {
  productId: IImageProcessingUsage["productId"];
  productImageId: IImageProcessingUsage["productImageId"];
  imageVersionId: IImageProcessingUsage["imageVersionId"];
  operation: IImageProcessingUsage["operation"];
  aiModel: string;
  originalImageHash: string | null;
  processingHash: string | null;
  promptVersion: string | null;
  processingConfigVersion: string | null;
  status: IImageProcessingUsage["status"];
  inputUsage: Record<string, unknown> | null;
  outputUsage: Record<string, unknown> | null;
  totalUsage: Record<string, unknown> | null;
  estimatedCost: number | null;
  estimatedCostIsApproximate: boolean;
  durationMs: number;
  errorMessage?: string;
  initiatedBy: IImageProcessingUsage["initiatedBy"];
}

export async function recordUsage(entry: NewUsageEntry): Promise<void> {
  await ImageProcessingUsage.create(entry);
}

export interface MonthlyUsageSummary {
  month: string;
  imagesProcessed: number;
  openaiOperations: number;
  estimatedCostUsd: number;
  estimatedCostIsApproximate: boolean;
  averageCostPerImage: number;
  monthlyBudgetUsd: number | null;
  remainingBudgetUsd: number | null;
  budgetUsagePercent: number | null;
  aiEnabled: boolean;
  dailyCount: number;
  dailyLimit: number | null;
  hourlyCount: number;
  hourlyLimit: number | null;
}

// Backs the read-only admin usage dashboard (env-var config, no settings UI —
// this is a report). `month` as "YYYY-MM"; defaults to the current month.
export async function getMonthlyUsageSummary(month?: string): Promise<MonthlyUsageSummary> {
  const start = month ? new Date(`${month}-01T00:00:00.000Z`) : startOfMonth();
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);

  const rows = await ImageProcessingUsage.aggregate([
    { $match: { createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: null,
        openaiOperations: { $sum: 1 },
        imagesProcessed: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
        estimatedCostUsd: { $sum: { $ifNull: ["$estimatedCost", 0] } },
        anyApproximate: { $max: { $cond: ["$estimatedCostIsApproximate", 1, 0] } },
      },
    },
  ]);
  const agg = rows[0] ?? { openaiOperations: 0, imagesProcessed: 0, estimatedCostUsd: 0, anyApproximate: 0 };

  const monthlyBudgetUsd = AI_IMAGE_CONFIG.monthlyBudgetUsd();
  const remainingBudgetUsd = monthlyBudgetUsd !== null ? monthlyBudgetUsd - agg.estimatedCostUsd : null;
  const budgetUsagePercent =
    monthlyBudgetUsd !== null && monthlyBudgetUsd > 0 ? (agg.estimatedCostUsd / monthlyBudgetUsd) * 100 : null;

  return {
    month: month ?? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    imagesProcessed: agg.imagesProcessed,
    openaiOperations: agg.openaiOperations,
    estimatedCostUsd: agg.estimatedCostUsd,
    estimatedCostIsApproximate: agg.anyApproximate === 1,
    averageCostPerImage: agg.imagesProcessed > 0 ? agg.estimatedCostUsd / agg.imagesProcessed : 0,
    monthlyBudgetUsd,
    remainingBudgetUsd,
    budgetUsagePercent,
    aiEnabled: isAiProcessingEnabled(),
    dailyCount: await countSince(startOfDay()),
    dailyLimit: AI_IMAGE_CONFIG.dailyLimit(),
    hourlyCount: await countSince(startOfHour()),
    hourlyLimit: AI_IMAGE_CONFIG.hourlyLimit(),
  };
}

export interface ProductUsageRow {
  productId: string;
  productTitle: string;
  imagesProcessed: number;
  operations: number;
  estimatedCostUsd: number;
}

export async function getUsageByProduct(): Promise<ProductUsageRow[]> {
  const rows = await ImageProcessingUsage.aggregate([
    {
      $group: {
        _id: "$productId",
        operations: { $sum: 1 },
        imagesProcessed: { $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] } },
        estimatedCostUsd: { $sum: { $ifNull: ["$estimatedCost", 0] } },
      },
    },
    { $sort: { estimatedCostUsd: -1 } },
  ]);

  const productIds = rows.map((r) => r._id);
  const products = await Product.find({ _id: { $in: productIds } }).select("title").lean();
  const titleById = new Map(products.map((p: any) => [String(p._id), p.title as string]));

  return rows.map((r) => ({
    productId: String(r._id),
    // null productId = the legacy pre-product-creation endpoint (image
    // processed before the product it belongs to was ever saved).
    productTitle: r._id === null ? "(before product created)" : titleById.get(String(r._id)) ?? "(deleted product)",
    imagesProcessed: r.imagesProcessed,
    operations: r.operations,
    estimatedCostUsd: r.estimatedCostUsd,
  }));
}
