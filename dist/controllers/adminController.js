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
        res.json(config);
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.getSiteConfig = getSiteConfig;
const updateSiteConfig = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        let config = yield SiteConfig_1.default.findOne();
        if (config) {
            Object.assign(config, req.body);
            const updatedConfig = yield config.save();
            res.json(updatedConfig);
        }
        else {
            const newConfig = new SiteConfig_1.default(req.body);
            const savedConfig = yield newConfig.save();
            res.json(savedConfig);
        }
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
exports.updateSiteConfig = updateSiteConfig;
