"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoanEnquiry = void 0;
const mongoose_1 = require("mongoose");
const LoanEnquirySchema = new mongoose_1.Schema({
    phone: {
        type: String,
        required: true,
        index: true,
    },
}, {
    timestamps: true, // adds createdAt & updatedAt
});
exports.LoanEnquiry = (0, mongoose_1.model)("LoanEnquiry", LoanEnquirySchema);
