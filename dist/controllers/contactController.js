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
exports.updateContactMessageStatus = exports.getContactMessages = exports.createContactMessage = void 0;
const ContactMessage_1 = require("../models/ContactMessage");
const wa_1 = require("../services/wa");
const createContactMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { name, email, subject, message } = req.body;
        if (!name || !email || !message) {
            return res.status(400).json({ success: false, message: "Name, email, and message are required" });
        }
        const doc = yield ContactMessage_1.ContactMessage.create({ name, email, subject, message });
        // Best-effort: a missing/failing WhatsApp alert must not make the
        // customer think their message wasn't received — it was, it's already
        // saved above. See sendAdminContactAlert's own no-op-until-configured
        // comment in services/wa.ts.
        try {
            yield (0, wa_1.sendAdminContactAlert)(name, email, message);
        }
        catch (err) {
            console.error("Contact form WhatsApp alert failed (message still saved):", err.message);
        }
        res.status(201).json({ success: true, id: doc._id });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.createContactMessage = createContactMessage;
// Admin inbox — newest first, capped like the other admin list endpoints.
const getContactMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const messages = yield ContactMessage_1.ContactMessage.find({}).sort({ createdAt: -1 }).limit(500);
        res.json(messages);
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.getContactMessages = getContactMessages;
const updateContactMessageStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        if (!["new", "read", "replied"].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }
        const doc = yield ContactMessage_1.ContactMessage.findByIdAndUpdate(req.params.id, { status }, { new: true });
        if (!doc)
            return res.status(404).json({ success: false, message: "Message not found" });
        res.json({ success: true, message: doc });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.updateContactMessageStatus = updateContactMessageStatus;
