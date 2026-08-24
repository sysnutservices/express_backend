// config/db.ts
import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

// Some Windows/VPN setups report a stale 127.0.0.1 resolver to Node's c-ares,
// which breaks the SRV lookup mongodb+srv:// needs (OS-level DNS works fine).
// ponytail: global override, scope to the mongo lookup only if this ever bites another consumer
if (process.platform === "win32") dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGO_URI;

    if (!mongoURI) {
      throw new Error("❌ MONGO_URI is missing in environment variables");
    }

    const conn = await mongoose.connect(mongoURI);

    console.log(`📦 MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1); // Stop the server if DB fails
  }
};

export default connectDB;
