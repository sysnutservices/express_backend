"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Category = exports.DEFAULT_CONFIG_OPTIONS = void 0;
const mongoose_1 = __importStar(require("mongoose"));
exports.DEFAULT_CONFIG_OPTIONS = {
    ram: [
        { label: "8GB RAM", value: "8GB", price: 0 },
        { label: "16GB RAM", value: "16GB", price: 4000 },
        { label: "32GB RAM", value: "32GB", price: 8000 },
    ],
    storage: [
        { label: "256GB SSD", value: "256GB", price: 0 },
        { label: "512GB SSD", value: "512GB", price: 3000 },
        { label: "1TB SSD", value: "1TB", price: 6000 },
    ],
    warranty: [
        { label: "1 Year Warranty", value: "1 Year", price: 0 },
        { label: "2 Year Coverage", value: "2 Year", price: 2499 },
        { label: "3 Year Premium", value: "3 Year", price: 4499 },
    ],
};
exports.Category = {
    BUSINESS: "Business Laptops",
    GAMING: "Gaming Laptops",
    ULTRABOOKS: "Ultrabooks",
    WORKSTATIONS: "Workstations",
    STUDENT: "Student & Home",
    ACCESSORIES: "Accessories",
};
const ConfigOptionSchema = new mongoose_1.Schema({
    label: String,
    value: String,
    price: Number,
}, { _id: false });
const ProductSchema = new mongoose_1.Schema({
    productId: { type: String, required: true },
    slug: { type: String },
    title: { type: String, required: true },
    brand: { type: String, required: true },
    category: {
        type: String,
        required: true,
        enum: Object.values(exports.Category),
    },
    description: { type: String, required: true },
    specs: {
        processor: { type: String },
        ram: { type: String },
        storage: { type: String },
        display: { type: String },
        graphics: { type: String },
        os: { type: String },
    },
    rating: { type: Number, default: 0 },
    reviews: { type: Number, default: 0 },
    price: { type: Number, required: true },
    discountPercent: { type: Number, default: 0 },
    finalPrice: { type: Number, required: true },
    stock: { type: Number, default: 0 },
    image: { type: String, required: true },
    images: [{ type: String }],
    isNewItem: { type: Boolean, default: false },
    isTrending: { type: Boolean, default: false },
    isBestDeal: { type: Boolean, default: false },
    condition: {
        type: String,
        enum: ["Like New", "Excellent", "Good", "New"],
        default: "Excellent",
    },
    // ⭐ Added CONFIG inside product
    configOptions: {
        ram: {
            type: [ConfigOptionSchema],
            default: () => exports.DEFAULT_CONFIG_OPTIONS.ram,
        },
        storage: {
            type: [ConfigOptionSchema],
            default: () => exports.DEFAULT_CONFIG_OPTIONS.storage,
        },
        warranty: {
            type: [ConfigOptionSchema],
            default: () => exports.DEFAULT_CONFIG_OPTIONS.warranty,
        },
    },
}, { timestamps: true });
exports.default = mongoose_1.default.model("Product", ProductSchema);
