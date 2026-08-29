"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENAI_IMAGE_PRICING = exports.AI_IMAGE_CONFIG = void 0;
// Feature-scoped config for the OpenAI image-processing budget/kill-switch
// and pricing. Not a general config/env.ts — nothing else in this codebase
// wants one; this exists only because Phase 25A explicitly forbids
// scattering these numbers across files, and this feature alone adds 7 env
// vars. Values are read lazily (functions, not eager module-level consts) so
// they match the rest of the codebase's per-call process.env.X convention
// and stay live if the process env changes without a restart (e.g. tests).
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function numOrNull(raw) {
    if (raw === undefined || raw === "")
        return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}
function intOrNull(raw) {
    const n = numOrNull(raw);
    return n === null ? null : Math.trunc(n);
}
exports.AI_IMAGE_CONFIG = {
    // Kill switch defaults ON — only an explicit "false" disables AI processing.
    enabled: () => process.env.OPENAI_IMAGE_PROCESSING_ENABLED !== "false",
    monthlyBudgetUsd: () => numOrNull(process.env.OPENAI_IMAGE_MONTHLY_BUDGET_USD),
    dailyLimit: () => intOrNull(process.env.OPENAI_IMAGE_DAILY_LIMIT),
    hourlyLimit: () => intOrNull(process.env.OPENAI_IMAGE_HOURLY_LIMIT),
};
// GPT Image pricing changes and depends on the actual request, so no cost is
// ever hard-coded — only what's configured here is used, and if nothing is
// configured, cost estimation reports null/approximate rather than a
// fabricated number (see imageCostControl.estimateCost).
exports.OPENAI_IMAGE_PRICING = {
    model: "gpt-image-2",
    inputCostPer1kUnits: () => numOrNull(process.env.OPENAI_IMAGE_PRICE_INPUT_PER_1K),
    outputCostPer1kUnits: () => numOrNull(process.env.OPENAI_IMAGE_PRICE_OUTPUT_PER_1K),
    // Flat per-call fallback USD cost, used only when usage-based rates above
    // aren't configured and OpenAI's response includes no usable usage info.
    flatCostPerCallUsd: () => numOrNull(process.env.OPENAI_IMAGE_FLAT_COST_USD),
};
