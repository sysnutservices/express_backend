"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSiteConfig = exports.getSiteConfig = exports.getDashboardStats = void 0;
const Order_1 = __importDefault(require("../models/Order"));
const Product_1 = __importDefault(require("../models/Product"));
const SiteConfig_1 = __importDefault(require("../models/SiteConfig"));
const getDashboardStats = async (req, res) => {
    try {
        const orders = await Order_1.default.find({});
        const products = await Product_1.default.find({});
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
};
exports.getDashboardStats = getDashboardStats;
const getSiteConfig = async (req, res) => {
    try {
        let config = await SiteConfig_1.default.findOne();
        if (!config) {
            // Return default if not found
            return res.json({});
        }
        res.json(config);
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};
exports.getSiteConfig = getSiteConfig;
const updateSiteConfig = async (req, res) => {
    try {
        let config = await SiteConfig_1.default.findOne();
        if (config) {
            Object.assign(config, req.body);
            const updatedConfig = await config.save();
            res.json(updatedConfig);
        }
        else {
            const newConfig = new SiteConfig_1.default(req.body);
            const savedConfig = await newConfig.save();
            res.json(savedConfig);
        }
    }
    catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};
exports.updateSiteConfig = updateSiteConfig;
