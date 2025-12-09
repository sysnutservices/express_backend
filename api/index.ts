import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import cors from "cors";

// Import compiled JS (NOT TS!) when running on Vercel
import apiRoutes from "../dist/src/routes/api.js";
import connectDB from "../dist/src/config/db.js";

dotenv.config();

const app = express();

connectDB();

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
);

app.use(express.json());

app.use("/api", apiRoutes);

app.get("/", (req, res) => {
    res.send("LapShark Backend Running on Vercel Serverless!");
});

export default serverless(app);
