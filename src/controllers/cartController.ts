import { Request, Response } from "express";
import Cart from "../models/Cart";
import Product from "../models/Product";
import User from "../models/User";
import AbandonedCart from "../models/AbandonedCartSettings";

/* ======================
   ADMIN: LIST ALL ACTIVE CARTS
====================== */
// Only logged-in customers' carts exist here at all — a guest's cart lives
// in their own browser's localStorage (see CartContext) and is never
// persisted server-side until they log in and mergeGuestCart runs, so a
// browsing-but-not-logged-in visitor's cart is invisible to this by design,
// not a bug. "items.0 exists" instead of items.length>0 so Mongo can use
// the same simple existence check as an index later if this ever needs one.
export const getAllActiveCarts = async (req: Request, res: Response) => {
    const carts = await Cart.find({ "items.0": { $exists: true } })
        .populate("userId", "name mobile email")
        .sort({ updatedAt: -1 });

    const result = carts.map((cart: any) => ({
        cartId: cart._id,
        customer: cart.userId
            ? { id: cart.userId._id, name: cart.userId.name, mobile: cart.userId.mobile, email: cart.userId.email }
            : null,
        items: cart.items,
        itemCount: cart.items.reduce((sum: number, i: any) => sum + (i.quantity || 1), 0),
        total: cart.items.reduce((sum: number, i: any) => sum + (i.finalPrice || 0) * (i.quantity || 1), 0),
        updatedAt: cart.updatedAt,
    }));

    res.json({ success: true, carts: result });
};

/* ======================
   CART LINE IDENTITY + ITEM BUILDER
====================== */
type CartConfig = { ram?: string; storage?: string; warranty?: string };

// One cart line per product+config. Keep this format in sync with
// cartLineId in Lapshark's context/CartContext.tsx — the frontend sends it
// back as the key for update/remove. An unconfigured item's line id is just
// its productId, which is also what legacy rows without a lineId match on.
export const cartLineId = (productId: string, config?: CartConfig | null) =>
    config && (config.ram || config.storage || config.warranty)
        ? `${productId}-${config.ram || "default"}-${config.storage || "default"}-${config.warranty || "none"}`
        : productId;

const lineKey = (item: any): string => item.lineId || item.productId;

// Builds a cart row from the live product. Used to ignore the requested
// config entirely, so a logged-in customer who picked 16GB/512GB got the
// base 8GB/256GB in their cart and at checkout. Config values are still
// never trusted blindly — anything the product doesn't actually offer is
// dropped — and price/title/specs always come from the product itself.
const buildCartItem = (product: any, rawConfig: any, quantity: number, waId: string) => {
    const p = product.toObject();
    const pick = (key: keyof CartConfig) => {
        const value = rawConfig?.[key];
        const opt = value ? (p.configOptions?.[key] || []).find((o: any) => o.value === value) : undefined;
        return opt ? { label: opt.label, value: opt.value, price: opt.price || 0 } : undefined;
    };
    const ram = pick("ram");
    const storage = pick("storage");
    const warranty = pick("warranty");
    const config = { ram: ram?.value, storage: storage?.value, warranty: warranty?.value };
    const productId = p._id.toString();
    const lineId = cartLineId(productId, config);
    const configured = lineId !== productId;
    const specs = p.specs || {};

    return {
        productId,
        lineId,
        title: ram && storage ? `${p.title} (${ram.value} / ${storage.value})` : p.title,
        image: p.image,
        finalPrice: p.finalPrice + (ram?.price || 0) + (storage?.price || 0) + (warranty?.price || 0),
        slug: p.slug,
        specs: { ...specs, ram: ram?.value || specs.ram, storage: storage?.value || specs.storage },
        config: configured ? config : undefined,
        configOptions: configured ? { ram, storage, warranty } : undefined,
        quantity,
        waId,
    };
};

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
    const { productId, config } = req.body;
    const mobile = await User.findById(userId)
    const product = await Product.findById(productId);
    if (!product) {
        return res.status(404).json({ message: "Product not found" });
    }

    const item = buildCartItem(product, config, 1, `91${mobile?.mobile}`);

    let cart = await Cart.findOne({ userId });

    if (!cart) {
        cart = await Cart.create({
            userId,
            items: [item], // ✅ items: [{}, {}]
        });
        return res.json(cart);
    }

    const existing = cart.items.find(
        (i: any) => lineKey(i) === item.lineId
    );

    if (existing) {
        existing.quantity = Math.min(5, existing.quantity + 1);
    } else {
        cart.items.push(item as any); // ✅ push new object
    }
    cart.notified = false;
    await cart.save();
    res.json(cart);
};




/* ======================
   MERGE GUEST CART (on login)
   ====================== */
// Called once, right after login, with whatever a guest had sitting in
// localStorage. Never trusts the guest's client-side snapshot for price/
// title/specs — same principle as addToCart above — it only reads
// productId+quantity+config out of each guest item and re-fetches the real
// product server-side. Quantities from a matching existing item add
// together (typical cart-merge behavior), everything is clamped to the
// same 1-5 range updateCartItem enforces, and a guest item pointing at a
// deleted/invalid product is skipped rather than crashing the whole merge.
export const mergeGuestCart = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const guestItems = Array.isArray(req.body.items) ? req.body.items : [];

    let cart = await Cart.findOne({ userId });
    if (!cart) cart = new Cart({ userId, items: [] });

    if (guestItems.length) {
        const mobile = await User.findById(userId);
        const productIds = guestItems.map((i: any) => i?.productId).filter(Boolean);
        const products = await Product.find({ _id: { $in: productIds } });

        for (const guestItem of guestItems) {
            const product = products.find((p) => p._id.toString() === guestItem?.productId);
            if (!product) continue; // deleted/invalid product — drop it rather than fail the merge

            const requestedQty = Math.max(1, Math.min(5, Number(guestItem.quantity) || 1));
            const item = buildCartItem(product, guestItem.config, requestedQty, `91${mobile?.mobile}`);
            const existing = cart.items.find((i: any) => lineKey(i) === item.lineId);

            if (existing) {
                existing.quantity = Math.max(1, Math.min(5, existing.quantity + requestedQty));
            } else {
                cart.items.push(item as any);
            }
        }
        cart.notified = false;
    }

    await cart.save();
    res.json(cart);
};

// `productId` in the body/URL of update/remove is the cart line id (see
// cartLineId) — it's still the bare productId for unconfigured/legacy rows.
export const updateCartItem = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId, quantity } = req.body;

    const cart = await Cart.findOne({ userId });
    if (!cart) return res.json({ items: [] });

    const item = cart.items.find((i: any) => lineKey(i) === productId);
    if (item) item.quantity = Math.max(1, Math.min(5, quantity));

    await cart.save();
    res.json(cart);
};

export const removeCartItem = async (req: Request, res: Response) => {
    const userId = (req as any).user.id;
    const { productId } = req.params;

    const cart = await Cart.findOne({ userId });
    if (cart) {
        cart.set("items", cart.items.filter((i: any) => lineKey(i) !== productId));
        await cart.save();
    }

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
