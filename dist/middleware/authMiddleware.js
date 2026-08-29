"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.internalOnly = exports.admin = exports.protect = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("../models/User"));
const protect = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            req.user = yield User_1.default.findById(decoded.id).select('-password');
            if (!req.user) {
                res.status(401).json({ message: 'Not authorized, user not found' });
                return;
            }
            // tokenVersion mismatch: an admin force-logout bumped it after this
            // token was issued (decoded.tokenVersion is undefined/0 for tokens
            // signed before this field existed — treated the same as 0 on the
            // user record, so pre-existing sessions aren't broken by this change).
            if ((decoded.tokenVersion || 0) !== (req.user.tokenVersion || 0)) {
                res.status(401).json({ message: 'Session expired, please log in again' });
                return;
            }
            // blockUser toggles this, but nothing previously enforced it here —
            // a blocked account's existing token kept working on every request.
            if (req.user.status === 'blocked') {
                res.status(401).json({ message: 'This account has been blocked' });
                return;
            }
            next();
        }
        catch (error) {
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }
    if (!token) {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
});
exports.protect = protect;
const admin = (req, res, next) => {
    var _a;
    if (((_a = req.user) === null || _a === void 0 ? void 0 : _a.role) === "admin") {
        return next();
    }
    return res.status(401).json({ message: "Not authorized as admin" });
};
exports.admin = admin;
// For endpoints called server-to-server by the abandoned-cart automation
// (wamigo_backend's cron + flow executor) rather than a logged-in Lapshark
// user — protect/admin don't apply since there's no user session at all.
const internalOnly = (req, res, next) => {
    const key = req.headers["x-internal-key"];
    if (key && key === process.env.INTERNAL_API_KEY) {
        return next();
    }
    return res.status(401).json({ message: "Not authorized" });
};
exports.internalOnly = internalOnly;
