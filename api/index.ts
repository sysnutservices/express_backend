import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import cors from "cors";

import apiRoutes from "../src/routes/api";
import connectDB from "../src/config/db";

dotenv.config();

const app = express();

// Connect database once per cold start
connectDB();

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
);

app.use(express.json());

// Attach routes
app.use("/api", apiRoutes);

// Default test route
app.get("/", (req, res) => {
    res.send("LapShark Backend Running on Vercel Serverless!");
});

// Export ONLY handler for Vercel
export const handler = serverless(app);
