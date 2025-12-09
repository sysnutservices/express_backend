import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import cors from "cors";

// IMPORTANT: Import compiled JS version
import apiRoutes from "../dist/routes/api.js";
import connectDB from "../dist/config/db.js";

dotenv.config();

const app = express();

// DB Connect (only once per cold start)
connectDB();

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
);

app.use(express.json());

// API routes
app.use("/api", apiRoutes);

// Test route
app.get("/", (req, res) => {
    res.send("LapShark Backend Running on Vercel!");
});

export default serverless(app);
