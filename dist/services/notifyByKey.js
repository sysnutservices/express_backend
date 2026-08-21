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
exports.notifyByKey = notifyByKey;
const EventDefinition_1 = __importDefault(require("../models/EventDefinition"));
const eventEmitter_1 = require("./eventEmitter");
function notifyByKey(eventKey, options) {
    return __awaiter(this, void 0, void 0, function* () {
        // 1️⃣ Validate event exists
        const eventDef = yield EventDefinition_1.default.findOne({
            key: eventKey,
            enabled: true
        }).lean();
        if (!eventDef) {
            console.warn(`[EVENT SKIPPED] Not registered: ${eventKey}`);
            return;
        }
        // 2️⃣ Emit event to WhatsApp backend
        yield (0, eventEmitter_1.emitEvent)({
            eventName: eventDef.key,
            waId: options.waId || "", // 🔥 IMPORTANT
            payload: Object.assign({ entityId: options.entityId }, options.payload)
        });
    });
}
