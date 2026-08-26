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
    // Both this route (public, storefront) and /admin/site-config's GET
    // (no auth either — pre-existing, unrelated to this) serve the same
    // document. metaCapiAccessToken is a real secret, so it never goes in
    // any GET response — only a presence flag, enough for the admin
    // Settings UI to show "configured" without exposing the value.
    const { analytics, ...rest } = config.toObject();
    res.json({
      ...rest,
      analytics: {
        gaMeasurementId: analytics?.gaMeasurementId || "",
        metaPixelId: analytics?.metaPixelId || "",
        clarityProjectId: analytics?.clarityProjectId || "",
        metaCapiAccessTokenSet: !!analytics?.metaCapiAccessToken,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

export const updateSiteConfig = async (req: Request, res: Response) => {
  try {
    let config = await SiteConfig.findOne();
    const body = { ...req.body };

    // The Settings UI never receives the real token back (see
    // getSiteConfig above), so it can never re-submit it either — "save
    // the form without retyping the token" must mean "keep the existing
    // one," not "wipe it." Only overwrite when a real, non-empty value
    // is explicitly provided.
    if (body.analytics) {
      const existingToken = config?.analytics?.metaCapiAccessToken;
      body.analytics = {
        ...body.analytics,
        metaCapiAccessToken: body.analytics.metaCapiAccessToken || existingToken || "",
      };
    }

    if (config) {
        Object.assign(config, body);
        const updatedConfig = await config.save();
        res.json(updatedConfig);
    } else {
        const newConfig = new SiteConfig(body);
        const savedConfig = await newConfig.save();
        res.json(savedConfig);
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};