"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const api_1 = __importDefault(require("./routes/api"));
const path_1 = __importDefault(require("path"));
const db_1 = __importDefault(require("./config/db"));
dotenv_1.default.config();
// Connect to Database
const app = (0, express_1.default)();
(0, db_1.default)();
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
app.use((0, cors_1.default)());
app.use(express_1.default.json({
    // Razorpay's webhook signature is computed over the exact raw bytes it
    // sent — verifying against a re-serialized req.body wouldn't reliably
    // match (key order/whitespace aren't guaranteed identical). Stashing the
    // raw buffer here on every request is cheap and lets the webhook route
    // live normally in routes/api.ts instead of needing its own express.raw()
    // wired in ahead of this middleware.
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});
// Routes
app.use('/api', api_1.default);
app.get('/', (req, res) => {
    res.send('API is running...');
});
app.listen(5000, "0.0.0.0", () => {
    console.log("Server running on http://0.0.0.0:5000");
});
