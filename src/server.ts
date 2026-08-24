
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import apiRoutes from './routes/api';
import path from 'path';
import connectDB from './config/db';

dotenv.config();

// Connect to Database

const app = express();
connectDB();

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(cors());
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
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.send('API is running...');
});

app.listen(5000, "0.0.0.0", () => {
  console.log("Server running on http://0.0.0.0:5000");
});
