import { Request, Response } from "express";
import Product from "../models/Product";
import { validateExtraOfferInput } from "../utils/pricing";

// Separate from productController.ts the same way couponController.ts is
// separate from it — a distinct pricing concern with its own CRUD, even
// though it lives on the Product document. "Save Promotion" in the admin UI
// is a standalone request, not bundled into the (multipart) product-update
// form submit, so an admin can add/edit an offer without re-uploading images.

// PUT /products/:id/extra-offer — create or update. Upsert semantics: there
// is only ever one offer per product (see Product.ts's comment), so "Save
// Promotion" always replaces whatever was there.
export const saveExtraOffer = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const { discountType, discountValue, offerLabel, startAt, endAt, isActive, showOnProduct, showOnListing, showOnHomepage, minimumMarginPercent } = req.body;

    const validation = validateExtraOfferInput({ discountType, discountValue: Number(discountValue), startAt, endAt }, product.finalPrice);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.message });
    }

    const adminId = (req as any).user?._id;
    product.extraOffer = {
      discountType,
      discountValue: Number(discountValue),
      offerLabel: offerLabel || undefined,
      startAt: startAt ? new Date(startAt) : null,
      endAt: endAt ? new Date(endAt) : null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      showOnProduct: showOnProduct !== undefined ? Boolean(showOnProduct) : true,
      showOnListing: showOnListing !== undefined ? Boolean(showOnListing) : true,
      showOnHomepage: showOnHomepage !== undefined ? Boolean(showOnHomepage) : true,
      minimumMarginPercent: minimumMarginPercent !== undefined && minimumMarginPercent !== null && minimumMarginPercent !== "" ? Number(minimumMarginPercent) : undefined,
      createdBy: product.extraOffer?.createdBy || adminId,
      updatedBy: adminId,
    } as any;

    await product.save();
    res.json(product);
  } catch (err: any) {
    console.error("Error saving extra offer:", err);
    res.status(500).json({ message: "Error saving extra offer", error: err.message });
  }
};

// DELETE /products/:id/extra-offer — "Remove Promotion".
export const removeExtraOffer = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    product.extraOffer = undefined;
    await product.save();
    res.json(product);
  } catch (err: any) {
    console.error("Error removing extra offer:", err);
    res.status(500).json({ message: "Error removing extra offer", error: err.message });
  }
};
