import { Request, Response } from "express";
import Wishlist from "../models/Wishlist";
import Product from "../models/Product";

export const getWishlist = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const wishlist = await Wishlist.findOne({ userId });
    res.json(wishlist || { items: [] });
};

export const addToWishlist = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
        return res.status(404).json({ message: "Product not found" });
    }

    const item = {
        productId: product._id.toString(),
        title: product.title,
        image: product.image,
        price: product.price,
        finalPrice: product.finalPrice,
        specs: product.specs || {},
        addedAt: new Date()
    };

    let wishlist = await Wishlist.findOne({ userId });

    if (!wishlist) {
        wishlist = await Wishlist.create({
            userId,
            items: [item]
        });
        return res.json({ success: true, items: wishlist.items });
    }

    const exists = wishlist.items.some(
        (i: any) => i.productId === productId
    );

    if (!exists) {
        wishlist.items.push(item);
        await wishlist.save();
    }

    res.json({ success: true, items: wishlist.items });
};


export const removeFromWishlist = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId } = req.params;

    await Wishlist.findOneAndUpdate(
        { userId },
        { $pull: { items: { productId } } },
        { new: true }
    );

    res.json({ message: "Removed from wishlist" });
};
