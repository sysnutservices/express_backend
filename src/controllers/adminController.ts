import { Request, Response } from 'express';
import Order from '../models/Order';
import Product from '../models/Product';
import SiteConfig from '../models/SiteConfig';

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({});
    const products = await Product.find({});
    
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
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

export const getSiteConfig = async (req: Request, res: Response) => {
  try {
    let config = await SiteConfig.findOne();
    if (!config) {
        // Return default if not found
        return res.json({}); 
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

export const updateSiteConfig = async (req: Request, res: Response) => {
  try {
    let config = await SiteConfig.findOne();
    if (config) {
        Object.assign(config, req.body);
        const updatedConfig = await config.save();
        res.json(updatedConfig);
    } else {
        const newConfig = new SiteConfig(req.body);
        const savedConfig = await newConfig.save();
        res.json(savedConfig);
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};