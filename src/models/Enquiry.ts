import { Schema, model, Document } from "mongoose";

export interface LoanEnquiryDocument extends Document {
    phone: string;
    createdAt: Date;
}

const LoanEnquirySchema = new Schema<LoanEnquiryDocument>(
    {
        phone: {
            type: String,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true, // adds createdAt & updatedAt
    }
);

export const LoanEnquiry = model<LoanEnquiryDocument>(
    "LoanEnquiry",
    LoanEnquirySchema
);
