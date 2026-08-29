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
exports.EVENT_WEIGHTS = void 0;
exports.scoreToLevel = scoreToLevel;
exports.calculateIntentScore = calculateIntentScore;
const BehaviorEvent_1 = __importDefault(require("../models/BehaviorEvent"));
// Configurable weight per event — deliberately a plain map, not hardcoded
// inside the calculation, so tuning the model later is a one-line edit here
// rather than a code change to the scoring logic itself.
exports.EVENT_WEIGHTS = {
    page_view: 0,
    view_item: 1,
    warranty_select: 2,
    filter_used: 1,
    sort_used: 0,
    wishlist_add: 3,
    compare_started: 2,
    whatsapp_click: 7,
    add_to_cart: 10,
    coupon_applied: 3,
    begin_checkout: 20,
    checkout_payment_failed: 5,
    login: 2,
    generate_lead: 15,
    purchase: 100,
};
function scoreToLevel(score) {
    if (score >= 100)
        return "customer";
    if (score >= 21)
        return "hot";
    if (score >= 6)
        return "warm";
    return "cold";
}
// Recomputes from the visitor's full event history rather than incrementing
// a running counter — simpler and self-correcting (a bad write never
// compounds), and this collection's per-visitor event count is small enough
// that re-summing on every ingest is cheap. Revisit if that stops being true.
function calculateIntentScore(visitorId) {
    return __awaiter(this, void 0, void 0, function* () {
        const events = yield BehaviorEvent_1.default.find({ visitorId }).select("eventName").lean();
        return events.reduce((total, e) => { var _a; return total + ((_a = exports.EVENT_WEIGHTS[e.eventName]) !== null && _a !== void 0 ? _a : 0); }, 0);
    });
}
