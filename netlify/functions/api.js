import express from "express";
import serverless from "serverless-http";
import dotenv from "dotenv";
import cors from "cors";

import apiRoutes from "../../src/routes/api.js";
import connectDB from "../../src/config/db.js";

dotenv.config();

const app = express();

connectDB();

app.use(cors());
app.use(express.json());

app.use("/api", apiRoutes);

app.get("/", (req, res) => {
    res.send("Express backend running on Netlify!");
});

export const handler = serverless(app);
