import mongoose, { Schema, Document } from "mongoose";

export interface IBlog extends Document {

    title: string;
    excerpt: string;
    slug: string;
    date: string;
    image: string;
    content?: string;
    author?: string;
    status?: "draft" | "published";
    targetKeyword?: string;
}

const BlogSchema = new Schema<IBlog>(
    {

        title: {
            type: String,
            required: true,
            trim: true
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        excerpt: {
            type: String,
            required: true,
            trim: true
        },
        date: {
            type: String,
            required: true
        },
        image: {
            type: String,
            required: true
        },
        content: {
            type: String,
            trim: true
        },
        // Named author is an E-E-A-T signal and populates BlogPosting schema.
        author: {
            type: String,
            trim: true,
            default: "Lapshark Team"
        },
        // Defaults to published so manual creation through the admin editor
        // behaves exactly as before. Generated drafts pass "draft" explicitly.
        // Public reads filter on { status: { $ne: "draft" } } rather than
        // { status: "published" }, so posts created before this field existed
        // (which have no status at all) stay visible.
        status: {
            type: String,
            enum: ["draft", "published"],
            default: "published",
            index: true
        },
        // Which search term the post was written for, so performance can be
        // measured per keyword later.
        targetKeyword: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
);


export default mongoose.model<IBlog>("Blog", BlogSchema);   