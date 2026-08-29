"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.hashImageBuffer = hashImageBuffer;
exports.computeProcessingHash = computeProcessingHash;
exports.estimateCost = estimateCost;
exports.isAiProcessingEnabled = isAiProcessingEnabled;
exports.checkBudgetAndLimits = checkBudgetAndLimits;
exports.recordUsage = recordUsage;
exports.getMonthlyUsageSummary = getMonthlyUsageSummary;
exports.getUsageByProduct = getUsageByProduct;
const crypto_1 = __importDefault(require("crypto"));
const ImageProcessingUsage_1 = __importDefault(require("../models/ImageProcessingUsage"));
const Product_1 = __importDefault(require("../models/Product"));
const aiImageConfig_1 = require("../config/aiImageConfig");
// sha256 over stable-joined fields — same hashing convention as
// metaCapi.ts's sha256() helper, no new dependency.
function sha256(value) {
    return crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function hashImageBuffer(buffer) {
    return sha256(buffer.toString("base64"));
}
// Deliberately excludes every composition-only field (scale, position,
// offsets, shadow, canvas size, background, output format, quality) — those
// are Sharp-only per Phase 25A #4 and must never trigger a re-generation.
function computeProcessingHash(input) {
    return sha256([input.originalImageHash, input.viewType, input.promptVersion, input.processingConfigVersion].join("|"));
}
// Never invents a number: if OpenAI didn't return usable usage and no
// pricing env var is configured, cost is null/approximate rather than a
// guess (Phase 25A #15).
function estimateCost(usage) {
    var _a, _b;
    const inputRate = aiImageConfig_1.OPENAI_IMAGE_PRICING.inputCostPer1kUnits();
    const outputRate = aiImageConfig_1.OPENAI_IMAGE_PRICING.outputCostPer1kUnits();
    if (usage && (inputRate !== null || outputRate !== null)) {
        const inputTokens = Number((_a = usage.input_tokens) !== null && _a !== void 0 ? _a : 0);
        const outputTokens = Number((_b = usage.output_tokens) !== null && _b !== void 0 ? _b : 0);
        const amount = (inputTokens / 1000) * (inputRate !== null && inputRate !== void 0 ? inputRate : 0) + (outputTokens / 1000) * (outputRate !== null && outputRate !== void 0 ? outputRate : 0);
        if (Number.isFinite(amount) && amount > 0)
            return { amountUsd: amount, approximate: false };
    }
    const flat = aiImageConfig_1.OPENAI_IMAGE_PRICING.flatCostPerCallUsd();
    if (flat !== null)
        return { amountUsd: flat, approximate: true };
    return { amountUsd: null, approximate: true };
}
function isAiProcessingEnabled() {
    return aiImageConfig_1.AI_IMAGE_CONFIG.enabled();
}
function startOfMonth() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfDay() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfHour() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours());
}
function sumCostSince(date) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const rows = yield ImageProcessingUsage_1.default.aggregate([
            { $match: { createdAt: { $gte: date } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ["$estimatedCost", 0] } } } },
        ]);
        return (_b = (_a = rows[0]) === null || _a === void 0 ? void 0 : _a.total) !== null && _b !== void 0 ? _b : 0;
    });
}
function countSince(date) {
    return __awaiter(this, void 0, void 0, function* () {
        return ImageProcessingUsage_1.default.countDocuments({ createdAt: { $gte: date } });
    });
}
// Run BEFORE calling OpenAI. Sums money already spent this month/day/hour —
// including failed attempts, since a failed call still cost money — and
// blocks before a new call would push past a configured cap. Unset limits
// mean "no cap enforced", never a fabricated default.
function checkBudgetAndLimits(estimatedNextCostUsd) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!isAiProcessingEnabled())
            return { allowed: false, reason: "AI_DISABLED" };
        const monthlyBudget = aiImageConfig_1.AI_IMAGE_CONFIG.monthlyBudgetUsd();
        if (monthlyBudget !== null) {
            const spent = yield sumCostSince(startOfMonth());
            if (spent + (estimatedNextCostUsd !== null && estimatedNextCostUsd !== void 0 ? estimatedNextCostUsd : 0) > monthlyBudget) {
                return { allowed: false, reason: "MONTHLY_BUDGET" };
            }
        }
        const dailyLimit = aiImageConfig_1.AI_IMAGE_CONFIG.dailyLimit();
        if (dailyLimit !== null) {
            const count = yield countSince(startOfDay());
            if (count >= dailyLimit)
                return { allowed: false, reason: "DAILY_LIMIT" };
        }
        const hourlyLimit = aiImageConfig_1.AI_IMAGE_CONFIG.hourlyLimit();
        if (hourlyLimit !== null) {
            const count = yield countSince(startOfHour());
            if (count >= hourlyLimit)
                return { allowed: false, reason: "HOURLY_LIMIT" };
        }
        return { allowed: true };
    });
}
function recordUsage(entry) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ImageProcessingUsage_1.default.create(entry);
    });
}
// Backs the read-only admin usage dashboard (env-var config, no settings UI —
// this is a report). `month` as "YYYY-MM"; defaults to the current month.
function getMonthlyUsageSummary(month) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const start = month ? new Date(`${month}-01T00:00:00.000Z`) : startOfMonth();
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        const rows = yield ImageProcessingUsage_1.default.aggregate([
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
        const agg = (_a = rows[0]) !== null && _a !== void 0 ? _a : { openaiOperations: 0, imagesProcessed: 0, estimatedCostUsd: 0, anyApproximate: 0 };
        const monthlyBudgetUsd = aiImageConfig_1.AI_IMAGE_CONFIG.monthlyBudgetUsd();
        const remainingBudgetUsd = monthlyBudgetUsd !== null ? monthlyBudgetUsd - agg.estimatedCostUsd : null;
        const budgetUsagePercent = monthlyBudgetUsd !== null && monthlyBudgetUsd > 0 ? (agg.estimatedCostUsd / monthlyBudgetUsd) * 100 : null;
        return {
            month: month !== null && month !== void 0 ? month : `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
            imagesProcessed: agg.imagesProcessed,
            openaiOperations: agg.openaiOperations,
            estimatedCostUsd: agg.estimatedCostUsd,
            estimatedCostIsApproximate: agg.anyApproximate === 1,
            averageCostPerImage: agg.imagesProcessed > 0 ? agg.estimatedCostUsd / agg.imagesProcessed : 0,
            monthlyBudgetUsd,
            remainingBudgetUsd,
            budgetUsagePercent,
            aiEnabled: isAiProcessingEnabled(),
            dailyCount: yield countSince(startOfDay()),
            dailyLimit: aiImageConfig_1.AI_IMAGE_CONFIG.dailyLimit(),
            hourlyCount: yield countSince(startOfHour()),
            hourlyLimit: aiImageConfig_1.AI_IMAGE_CONFIG.hourlyLimit(),
        };
    });
}
function getUsageByProduct() {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield ImageProcessingUsage_1.default.aggregate([
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
        const products = yield Product_1.default.find({ _id: { $in: productIds } }).select("title").lean();
        const titleById = new Map(products.map((p) => [String(p._id), p.title]));
        return rows.map((r) => {
            var _a;
            return ({
                productId: String(r._id),
                // null productId = the legacy pre-product-creation endpoint (image
                // processed before the product it belongs to was ever saved).
                productTitle: r._id === null ? "(before product created)" : (_a = titleById.get(String(r._id))) !== null && _a !== void 0 ? _a : "(deleted product)",
                imagesProcessed: r.imagesProcessed,
                operations: r.operations,
                estimatedCostUsd: r.estimatedCostUsd,
            });
        });
    });
}
