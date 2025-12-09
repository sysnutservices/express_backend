"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// config/db.ts
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGO_URI;
        if (!mongoURI) {
            throw new Error("❌ MONGO_URI is missing in environment variables");
        }
        const conn = await mongoose_1.default.connect(mongoURI);
        console.log(`📦 MongoDB Connected: ${conn.connection.host}`);
    }
    catch (error) {
        console.error("❌ MongoDB connection error:", error);
        process.exit(1); // Stop the server if DB fails
    }
};
exports.default = connectDB;
