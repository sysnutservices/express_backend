import { Request, Response } from "express";
import { setEnvFileValue, isSafeEnvValue, maskSecret } from "../utils/envFile";
import { testConnection } from "../services/openaiClient";

// Admin-only key management for OPENAI_API_KEY. Persists to the backend's
// .env file (never the database, never echoed back to the frontend) —
// see envFile.ts. The key value itself never appears in a log line here.
export const getAiSettingsStatus = async (_req: Request, res: Response) => {
  const key = process.env.OPENAI_API_KEY;
  res.json({
    success: true,
    configured: !!key,
    keyPreview: key ? maskSecret(key) : null,
  });
};

export const updateAiSettings = async (req: Request, res: Response) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!isSafeEnvValue(apiKey)) {
    return res.status(400).json({ message: "Please provide a valid API key." });
  }
  try {
    setEnvFileValue("OPENAI_API_KEY", apiKey);
    res.json({ success: true, keyPreview: maskSecret(apiKey) });
  } catch {
    // Never include the underlying fs error — it could reference the server
    // path the .env file lives at.
    res.status(500).json({ message: "Could not save the API key on the server." });
  }
};

export const testAiConnection = async (_req: Request, res: Response) => {
  const result = await testConnection();
  res.json({ success: result.success, message: result.message });
};
