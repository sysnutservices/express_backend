import { Schema, model, Document } from "mongoose";

export interface ContactMessageDocument extends Document {
    name: string;
    email: string;
    subject?: string;
    message: string;
    status: "new" | "read" | "replied";
    createdAt: Date;
}

const ContactMessageSchema = new Schema<ContactMessageDocument>(
    {
        name: { type: String, required: true },
        email: { type: String, required: true },
        subject: { type: String },
        message: { type: String, required: true },
        status: { type: String, enum: ["new", "read", "replied"], default: "new" },
    },
    {
        timestamps: true,
    }
);

export const ContactMessage = model<ContactMessageDocument>(
    "ContactMessage",
    ContactMessageSchema
);
