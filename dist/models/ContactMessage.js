"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactMessage = void 0;
const mongoose_1 = require("mongoose");
const ContactMessageSchema = new mongoose_1.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    subject: { type: String },
    message: { type: String, required: true },
    status: { type: String, enum: ["new", "read", "replied"], default: "new" },
}, {
    timestamps: true,
});
exports.ContactMessage = (0, mongoose_1.model)("ContactMessage", ContactMessageSchema);
