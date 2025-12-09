import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import cors from "cors";

import apiRoutes from "../../dist/routes/api.js";
import connectDB from "../../dist/config/db.js";

dotenv.config();

const app = express();
connectDB();

app.use(cors());
app.use(express.json());

app.use("/api", apiRoutes);

app.get("/", (req, res) => {
    res.send("Express + TypeScript backend running on Netlify!");
});

export const handler = serverless(app);
