
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import apiRoutes from './routes/api';
import path from 'path';
import connectDB from './config/db';
import { globalApiLimiter } from './middleware/rateLimiters';

dotenv.config();

// Connect to Database

const app = express();

// LiteSpeed reverse-proxies this app on the VPS — without trust proxy, every
// IP-keyed rate limiter buckets by LiteSpeed's own IP instead of the real
// client's, effectively rate-limiting the whole site as one caller. Must be
// set before any rate-limit middleware is mounted below.
app.set('trust proxy', 1);

connectDB();

const corsOptions = {
  origin: ['https://lapshark.com', 'https://www.lapshark.com'],
  credentials: false, // Bearer-token auth, not cookies — matches the frontend's withCredentials: false
};

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
// helmet/cors only set response headers or read the Origin header — neither
// touches req.body, so the raw-body capture the Razorpay webhook signature
// check depends on (below) is unaffected regardless of ordering here.
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({
  // Razorpay's webhook signature is computed over the exact raw bytes it
  // sent — verifying against a re-serialized req.body wouldn't reliably
  // match (key order/whitespace aren't guaranteed identical). Stashing the
  // raw buffer here on every request is cheap and lets the webhook route
  // live normally in routes/api.ts instead of needing its own express.raw()
  // wired in ahead of this middleware.
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  },
}));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});


// Routes
app.use('/api', globalApiLimiter, apiRoutes);

app.get('/', (req, res) => {
  res.send('API is running...');
});

app.listen(5000, "0.0.0.0", () => {
  console.log("Server running on http://0.0.0.0:5000");
});
