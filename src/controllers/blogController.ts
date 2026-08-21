import { Request, Response } from "express";
import slugify from "slugify";
import Blog from "../models/Blog.js";
import mongoose from "mongoose";

export const createBlog = async (req: Request, res: Response) => {
    try {
        let { title, content, excerpt, image, slug, status, targetKeyword, author } = req.body;

        console.log("📝 Request body:", req.body);

        if (!title || !excerpt) {
            return res.status(400).json({
                message: "Title and excerpt required",
                received: { title, excerpt }
            });
        }

        if (!image) {
            return res.status(400).json({
                message: "Image is required"
            });
        }

        if (!slug) {
            slug = slugify(title, { lower: true, strict: true });
        }

        console.log("💾 Creating blog with data:", { title, excerpt, slug, image, content });

        const blog = await Blog.create({
            title,
            excerpt,
            slug,
            image,
            content,
            date: new Date().toISOString(),
            // Only "draft" is honoured as an override; anything else falls back
            // to the schema default of published.
            ...(status === "draft" ? { status: "draft" } : {}),
            ...(targetKeyword ? { targetKeyword } : {}),
            ...(author ? { author } : {}),
        });

        res.status(201).json(blog);
    } catch (error) {
        console.error("❌ Create blog error:", error);
        res.status(500).json({
            message: "Create blog failed",
            error: error instanceof Error ? {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            } : String(error)
        });
    }
};

// Public feed. $ne:"draft" rather than status:"published" so posts written
// before the status field existed (no status at all) remain visible.
export const getAllBlogs = async (_: Request, res: Response) => {
    try {
        const blogs = await Blog.find({ status: { $ne: "draft" } }).sort({ createdAt: -1 });
        res.json(blogs);
    } catch (error) {
        res.status(500).json({ message: "Fetch blogs failed" });
    }
};

// Admin feed: includes drafts. Kept on a separate route so the public one can
// stay cached — a single endpoint varying by auth would poison the cache.
export const getAllBlogsAdmin = async (_: Request, res: Response) => {
    try {
        const blogs = await Blog.find().sort({ createdAt: -1 });
        res.json(blogs);
    } catch (error) {
        res.status(500).json({ message: "Fetch blogs failed" });
    }
};

export const getBlogBySlug = async (req: Request, res: Response) => {
    try {
        // Drafts 404 publicly: a reachable draft URL can be crawled and indexed
        // before anyone has approved the content.
        const blog = await Blog.findOne({ slug: req.params.slug, status: { $ne: "draft" } });

        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }

        res.json(blog);
    } catch (error) {
        res.status(500).json({ message: "Fetch blog failed" });
    }
};

export const updateBlog = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { title, content, excerpt, image, slug: newSlug } = req.body;

        console.log("🔄 Updating blog by ID:", id);
        console.log("📦 Request body:", req.body);

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid blog id" });
        }

        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ message: "No update data provided" });
        }

        const updateData: any = {};

        if (title) {
            updateData.title = title;
            updateData.slug = newSlug || slugify(title, { lower: true, strict: true });
        }

        if (excerpt) updateData.excerpt = excerpt;
        // The approve/unpublish switch for the admin panel.
        if (req.body.status === "draft" || req.body.status === "published") {
            updateData.status = req.body.status;
        }
        if (req.body.targetKeyword !== undefined) updateData.targetKeyword = req.body.targetKeyword;
        if (image) {
            updateData.image = image;
            console.log("✅ Image will be updated to:", image);
        }
        if (content !== undefined) updateData.content = content;
        if (newSlug && !title) updateData.slug = newSlug;

        updateData.updatedAt = new Date().toISOString();

        console.log("📝 Final update data:", updateData);

        const blog = await Blog.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }

        console.log("✅ Blog updated successfully:", blog);
        res.json(blog);
    } catch (error) {
        console.error("❌ Update blog error:", error);
        res.status(500).json({
            message: "Update blog failed",
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

export const deleteBlog = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid blog id" });
        }

        const blog = await Blog.findByIdAndDelete(id);

        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }

        res.json({ success: true, message: "Blog deleted successfully" });
    } catch (error) {
        console.error("❌ Delete blog error:", error);
        res.status(500).json({ message: "Delete blog failed" });
    }
};