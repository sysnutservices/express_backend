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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSiteConfig = exports.getSiteConfig = exports.getDashboardStats = void 0;
const Order_1 = __importDefault(require("../models/Order"));
const Product_1 = __importDefault(require("../models/Product"));
const SiteConfig_1 = __importDefault(require("../models/SiteConfig"));
const getDashboardStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const orders = yield Order_1.default.find({});
        const products = yield Product_1.default.find({});
        const totalRevenue = orders.reduce((acc, order) => acc + order.total, 0);
        const totalOrders = orders.length;
        const totalProducts = products.length;
        const lowStockCount = products.filter(p => p.stock < 5).length;
        res.json({
            totalRevenue,
            totalOrders,
            totalProducts,
            lowStockCount
        });
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.getDashboardStats = getDashboardStats;
const getSiteConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let config = yield SiteConfig_1.default.findOne();
        if (!config) {
            // Return default if not found
            return res.json({});
        }
        // Both this route (public, storefront) and /admin/site-config's GET
        // (no auth either — pre-existing, unrelated to this) serve the same
        // document. metaCapiAccessToken is a real secret, so it never goes in
        // any GET response — only a presence flag, enough for the admin
        // Settings UI to show "configured" without exposing the value.
        const _a = config.toObject(), { analytics } = _a, rest = __rest(_a, ["analytics"]);
        res.json(Object.assign(Object.assign({}, rest), { analytics: {
                gaMeasurementId: (analytics === null || analytics === void 0 ? void 0 : analytics.gaMeasurementId) || "",
                metaPixelId: (analytics === null || analytics === void 0 ? void 0 : analytics.metaPixelId) || "",
                clarityProjectId: (analytics === null || analytics === void 0 ? void 0 : analytics.clarityProjectId) || "",
                metaCapiAccessTokenSet: !!(analytics === null || analytics === void 0 ? void 0 : analytics.metaCapiAccessToken),
            } }));
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.getSiteConfig = getSiteConfig;
const updateSiteConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        let config = yield SiteConfig_1.default.findOne();
        const body = Object.assign({}, req.body);
        // The Settings UI never receives the real token back (see
        // getSiteConfig above), so it can never re-submit it either — "save
        // the form without retyping the token" must mean "keep the existing
        // one," not "wipe it." Only overwrite when a real, non-empty value
        // is explicitly provided.
        if (body.analytics) {
            const existingToken = (_a = config === null || config === void 0 ? void 0 : config.analytics) === null || _a === void 0 ? void 0 : _a.metaCapiAccessToken;
            body.analytics = Object.assign(Object.assign({}, body.analytics), { metaCapiAccessToken: body.analytics.metaCapiAccessToken || existingToken || "" });
        }
        if (config) {
            Object.assign(config, body);
            const updatedConfig = yield config.save();
            res.json(updatedConfig);
        }
        else {
            const newConfig = new SiteConfig_1.default(body);
            const savedConfig = yield newConfig.save();
            res.json(savedConfig);
        }
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.updateSiteConfig = updateSiteConfig;
