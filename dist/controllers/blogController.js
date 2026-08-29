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
exports.deleteBlog = exports.updateBlog = exports.getBlogBySlug = exports.getAllBlogsAdmin = exports.getAllBlogs = exports.createBlog = void 0;
const slugify_1 = __importDefault(require("slugify"));
const Blog_1 = __importDefault(require("../models/Blog"));
const mongoose_1 = __importDefault(require("mongoose"));
const createBlog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
            slug = (0, slugify_1.default)(title, { lower: true, strict: true });
        }
        console.log("💾 Creating blog with data:", { title, excerpt, slug, image, content });
        const blog = yield Blog_1.default.create(Object.assign(Object.assign(Object.assign({ title,
            excerpt,
            slug,
            image,
            content, date: new Date().toISOString() }, (status === "draft" ? { status: "draft" } : {})), (targetKeyword ? { targetKeyword } : {})), (author ? { author } : {})));
        res.status(201).json(blog);
    }
    catch (error) {
        console.error("❌ Create blog error:", error);
        res.status(500).json({
            message: "Create blog failed",
            error: error instanceof Error ? {
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            } : String(error)
        });
    }
});
exports.createBlog = createBlog;
// Public feed. $ne:"draft" rather than status:"published" so posts written
// before the status field existed (no status at all) remain visible.
const getAllBlogs = (_, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const blogs = yield Blog_1.default.find({ status: { $ne: "draft" } }).sort({ createdAt: -1 });
        res.json(blogs);
    }
    catch (error) {
        res.status(500).json({ message: "Fetch blogs failed" });
    }
});
exports.getAllBlogs = getAllBlogs;
// Admin feed: includes drafts. Kept on a separate route so the public one can
// stay cached — a single endpoint varying by auth would poison the cache.
const getAllBlogsAdmin = (_, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const blogs = yield Blog_1.default.find().sort({ createdAt: -1 });
        res.json(blogs);
    }
    catch (error) {
        res.status(500).json({ message: "Fetch blogs failed" });
    }
});
exports.getAllBlogsAdmin = getAllBlogsAdmin;
const getBlogBySlug = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Drafts 404 publicly: a reachable draft URL can be crawled and indexed
        // before anyone has approved the content.
        const blog = yield Blog_1.default.findOne({ slug: req.params.slug, status: { $ne: "draft" } });
        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }
        res.json(blog);
    }
    catch (error) {
        res.status(500).json({ message: "Fetch blog failed" });
    }
});
exports.getBlogBySlug = getBlogBySlug;
const updateBlog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const { title, content, excerpt, image, slug: newSlug } = req.body;
        console.log("🔄 Updating blog by ID:", id);
        console.log("📦 Request body:", req.body);
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid blog id" });
        }
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ message: "No update data provided" });
        }
        const updateData = {};
        if (title) {
            updateData.title = title;
            updateData.slug = newSlug || (0, slugify_1.default)(title, { lower: true, strict: true });
        }
        if (excerpt)
            updateData.excerpt = excerpt;
        // The approve/unpublish switch for the admin panel.
        if (req.body.status === "draft" || req.body.status === "published") {
            updateData.status = req.body.status;
        }
        if (req.body.targetKeyword !== undefined)
            updateData.targetKeyword = req.body.targetKeyword;
        if (image) {
            updateData.image = image;
            console.log("✅ Image will be updated to:", image);
        }
        if (content !== undefined)
            updateData.content = content;
        if (newSlug && !title)
            updateData.slug = newSlug;
        updateData.updatedAt = new Date().toISOString();
        console.log("📝 Final update data:", updateData);
        const blog = yield Blog_1.default.findByIdAndUpdate(id, { $set: updateData }, { new: true, runValidators: true });
        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }
        console.log("✅ Blog updated successfully:", blog);
        res.json(blog);
    }
    catch (error) {
        console.error("❌ Update blog error:", error);
        res.status(500).json({
            message: "Update blog failed",
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
exports.updateBlog = updateBlog;
const deleteBlog = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid blog id" });
        }
        const blog = yield Blog_1.default.findByIdAndDelete(id);
        if (!blog) {
            return res.status(404).json({ message: "Blog not found" });
        }
        res.json({ success: true, message: "Blog deleted successfully" });
    }
    catch (error) {
        console.error("❌ Delete blog error:", error);
        res.status(500).json({ message: "Delete blog failed" });
    }
});
exports.deleteBlog = deleteBlog;
