import { Request, Response } from "express";
import Cart from "../models/Cart";
import Product from "../models/Product";
import User from "../models/User";
import AbandonedCart from "../models/AbandonedCartSettings";

/* ======================
   GET CART
====================== */
export const getCart = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;

    const cart = await Cart.findOne({ userId });
    res.json(cart || { items: [] });
};

/* ======================
   ADD TO CART
====================== */
export const addToCart = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId } = req.body;
    const mobile = await User.findById(userId)
    const product = await Product.findById(productId);
    if (!product) {
        return res.status(404).json({ message: "Product not found" });
    }

    const item = {
        productId: product._id.toString(),
        title: product.title,
        image: product.image,
        finalPrice: product.finalPrice,
        slug: product.slug,
        specs: product.specs || {},
        quantity: 1,
        waId: `91${mobile?.mobile}`
    };

    let cart = await Cart.findOne({ userId });

    if (!cart) {
        cart = await Cart.create({
            userId,
            items: [item], // ✅ items: [{}, {}]
        });
        return res.json(cart);
    }

    const existing = cart.items.find(
        (i: any) => i.productId === productId
    );

    if (existing) {
        existing.quantity += 1;
    } else {
        cart.items.push(item); // ✅ push new object
    }
    cart.notified = false;
    await cart.save();
    res.json(cart);
};




export const updateCartItem = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId, quantity } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.json({ items: [] });

    const item = cart.items.find((i: any) => i.productId === productId);
    if (item) item.quantity = Math.max(1, Math.min(5, quantity));

    await cart.save();
    res.json(cart);
};

export const removeCartItem = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId } = req.params;

    await Cart.findOneAndUpdate(
        { userId },
        { $pull: { items: { productId } } },
        { new: true }
    );

    res.json({ message: "Item removed" });
};

/* ======================
   CLEAR CART
====================== */
export const clearCart = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    await Cart.findOneAndUpdate(
        { userId },
        { $set: { items: [] } }
    );
    res.json({ message: "Cart cleared" });
};
export const getCartByWaId = async (req: Request, res: Response) => {
    const rawWaId = req.params.waId.replace(/\D/g, ""); // clean non-digits

    const mobile =
        rawWaId.startsWith("91") && rawWaId.length === 12
            ? rawWaId.slice(2)
            : rawWaId;

    const user = await User.findOne({ mobile });
    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }

    const cart = await Cart.findOne({ userId: user._id });
    const item = cart?.items?.[0];

    const product = item
        ? {
            title: item.title,
            slug: item.slug,
            image: item.image
        }
        : null;

    res.json({
        items: cart?.items || []
    });
};

export const getAllCart = async (req: Request, res: Response) => {

    // 1️⃣ Get abandoned cart settings (single document)
    const settings = await AbandonedCart.findOne();

    // If feature is disabled → return empty safely
    if (!settings || !settings.isEnabled) {
        return res.json({
            cartId: null,
            product: null,
            items: []
        });
    }

    // 2️⃣ Find active cart (not notified yet)
    const cart = await Cart.findOne({
        notified: false,
        status: true
    });

    if (!cart) {
        return res.json({
            cartId: null,
            product: null,
            items: []
        });
    }

    // 3️⃣ Time gap check (ABANDONED LOGIC)
    const timeGapMs = settings.timeGapMinutes * 60 * 1000;
    const isAbandoned =
        cart.updatedAt.getTime() + timeGapMs < Date.now();

    if (!isAbandoned) {
        return res.json({
            cartId: null,
            product: null,
            items: []
        });
    }

    // 4️⃣ Product preview (same as your code)
    const item = cart.items?.[0];

    const product = item
        ? {
            title: item.title,
            slug: item.slug,
            image: item.image
        }
        : null;

    res.json({
        cartId: cart._id,
        product,
        items: cart.items
    });
};



export const notifiedCart = async (req: Request, res: Response) => {
    const cartId = req.params.cartId; // MUST be string


    await Cart.findByIdAndUpdate(
        cartId,
        { $set: { notified: true } }
    );

    res.json({ message: "Cart notified" });
};
export const getAbandonedCartSettings = async (
    req: Request,
    res: Response
) => {
    let settings = await AbandonedCart.findOne();

    // create default if not exists
    if (!settings) {
        settings = await AbandonedCart.create({});
    }

    res.json({
        isEnabled: settings.isEnabled,
        timeGapMinutes: settings.timeGapMinutes
    });
};

// controllers/abandonedCart.controller.ts
export const updateAbandonedCartSettings = async (
    req: Request,
    res: Response
) => {
    const { isEnabled, timeGapMinutes } = req.body;

    let settings = await AbandonedCart.findOne();

    if (!settings) {
        settings = await AbandonedCart.create({});
    }

    if (typeof isEnabled === "boolean") {
        settings.isEnabled = isEnabled;
    }

    if (typeof timeGapMinutes === "number" && timeGapMinutes > 0) {
        settings.timeGapMinutes = timeGapMinutes;
    }

    await settings.save();

    res.json({
        message: "Abandoned cart settings updated",
        isEnabled: settings.isEnabled,
        timeGapMinutes: settings.timeGapMinutes
    });
};
