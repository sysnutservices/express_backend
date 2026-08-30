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
Object.defineProperty(exports, "__esModule", { value: true });
exports.testAiConnection = exports.updateAiSettings = exports.getAiSettingsStatus = void 0;
const envFile_1 = require("../utils/envFile");
const openaiClient_1 = require("../services/openaiClient");
// Admin-only key management for OPENAI_API_KEY. Persists to the backend's
// .env file (never the database, never echoed back to the frontend) —
// see envFile.ts. The key value itself never appears in a log line here.
const getAiSettingsStatus = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const key = process.env.OPENAI_API_KEY;
    res.json({
        success: true,
        configured: !!key,
        keyPreview: key ? (0, envFile_1.maskSecret)(key) : null,
    });
});
exports.getAiSettingsStatus = getAiSettingsStatus;
const updateAiSettings = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const apiKey = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.apiKey) === "string" ? req.body.apiKey.trim() : "";
    if (!(0, envFile_1.isSafeEnvValue)(apiKey)) {
        return res.status(400).json({ message: "Please provide a valid API key." });
    }
    try {
        (0, envFile_1.setEnvFileValue)("OPENAI_API_KEY", apiKey);
        res.json({ success: true, keyPreview: (0, envFile_1.maskSecret)(apiKey) });
    }
    catch (_b) {
        // Never include the underlying fs error — it could reference the server
        // path the .env file lives at.
        res.status(500).json({ message: "Could not save the API key on the server." });
    }
});
exports.updateAiSettings = updateAiSettings;
const testAiConnection = (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield (0, openaiClient_1.testConnection)();
    res.json({ success: result.success, message: result.message });
});
exports.testAiConnection = testAiConnection;
