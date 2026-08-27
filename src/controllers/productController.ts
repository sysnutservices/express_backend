import { Request, Response } from 'express';
import Product from '../models/Product';
import slugify from 'slugify';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { imagekit, uploadToImageKit, uploadUrlToImageKit, uploadBufferToImageKit } from '../services/imagekit';
import { processProductImage, ProductViewType, ViewPreset, VIEW_PRESETS } from '../services/imageProcessing';

// Configure multer storage
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     const uploadPath = path.join(__dirname, '../../uploads/products');
//     if (!fs.existsSync(uploadPath)) {
//       fs.mkdirSync(uploadPath, { recursive: true });
//     }
//     cb(null, uploadPath);
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });



const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'));
  }
};

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter,
});


export const getProducts = async (req: Request, res: Response) => {
  try {
    const products = await Product.find({});
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

export const getProductById = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

export const getProductBySlug = async (req: Request, res: Response) => {
  try {
    console.log("Slug received:", req.params.slug);

    const product = await Product.findOne({ slug: req.params.slug });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);

  } catch (error: any) {
    console.error("Actual Error:", error);
    res.status(400).json({ message: "Server Error", error: error.message });
  }
};

// A product without a slug has no reachable URL and is dropped from the
// sitemap, so one is always generated. Suffixes on collision because slug is a
// unique index — a duplicate title would otherwise throw E11000 on save.
async function uniqueSlug(title: string, excludeId?: string): Promise<string> {
  // Product titles are pipe-separated spec strings. slugify's strict mode maps
  // "|" to the word "or", producing dell-5400-or-intel-i5-or-8gb, so the
  // separators are stripped to spaces first.
  const cleaned = String(title || 'product').replace(/[|/\\]+/g, ' ');
  const base = slugify(cleaned, { lower: true, strict: true }) || 'product';
  let slug = base;
  let n = 2;
  while (
    await Product.exists({
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

export const createProduct = async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // Get main image
    let mainImage = "";
    let galleryImages: string[] = [];

    // MAIN IMAGE UPLOAD
    if (files?.image?.[0]) {
      const uploadResult = await uploadToImageKit(
        files.image[0],
        "/lapshark/products"
      );
      mainImage = uploadResult.url;
    }

    // GALLERY IMAGE UPLOAD
    if (files?.images?.length) {
      const uploadResults = await Promise.all(
        files.images.map((img) =>
          uploadToImageKit(img, "/lapshark/products/gallery")
        )
      );
      galleryImages = uploadResults.map(res => res.url);
    }

    // URL-based images — used by the CRM's Product Sync Service (already
    // hosted elsewhere) and by the admin form's auto background-removal step
    // (already hosted on ImageKit by the time Save runs). Main image: file
    // wins if both are present. Gallery: appended alongside any uploaded
    // files rather than replacing them, since a save can legitimately mix
    // processed URLs with raw-file fallbacks for images that failed to process.
    if (!mainImage && req.body.imageUrl) {
      const uploaded = await uploadUrlToImageKit(req.body.imageUrl, "/lapshark/products");
      mainImage = uploaded.url;
    }
    if (req.body.imageUrls) {
      const urls: string[] = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
      const uploadResults = await Promise.all(urls.map((u) => uploadUrlToImageKit(u, "/lapshark/products/gallery")));
      galleryImages = [...galleryImages, ...uploadResults.map((res) => res.url)];
    }

    // Parse JSON data from form-data
    const productData = {
      ...req.body,
      price: Number(req.body.price),
      discountPercent: Number(req.body.discountPercent || 0),
      stock: Number(req.body.stock),
      rating: Number(req.body.rating || 0),
      reviews: Number(req.body.reviews || 0),
      finalPrice: Number(req.body.finalPrice),
      weightKg: req.body.weightKg !== undefined ? Number(req.body.weightKg) : undefined,
      lengthCm: req.body.lengthCm !== undefined ? Number(req.body.lengthCm) : undefined,
      widthCm: req.body.widthCm !== undefined ? Number(req.body.widthCm) : undefined,
      heightCm: req.body.heightCm !== undefined ? Number(req.body.heightCm) : undefined,
      image: mainImage,
      images: galleryImages,
      specs: req.body.specs ? JSON.parse(req.body.specs) : {},
      configOptions: req.body.configOptions ? JSON.parse(req.body.configOptions) : undefined,
      isNewItem: req.body.isNewItem === 'true',
      isTrending: req.body.isTrending === 'true',
      isBestDeal: req.body.isBestDeal === 'true',
      useCases: req.body.useCases ? JSON.parse(req.body.useCases) : [],
      tags: req.body.tags ? JSON.parse(req.body.tags) : [],
      performanceTier: req.body.performanceTier || undefined,
      qualityReport: req.body.qualityReport ? JSON.parse(req.body.qualityReport) : undefined,
    };

    // Generated from the title when the admin form leaves it blank.
    if (!productData.slug || !String(productData.slug).trim()) {
      productData.slug = await uniqueSlug(productData.title);
    } else {
      productData.slug = await uniqueSlug(String(productData.slug));
    }

    const product = new Product(productData);
    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
  } catch (error: any) {
    console.error('Error creating product:', error);
    res.status(400).json({ message: 'Invalid product data', error: error.message });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const files = req.files as { [field: string]: Express.Multer.File[] };

    //
    // 1️⃣ MAIN IMAGE (Upload to ImageKit)
    //
    if (files?.image?.[0]) {
      const uploadResult = await uploadToImageKit(
        files.image[0],
        "/lapshark/products"
      );
      product.image = uploadResult.url;
    } else if (req.body.imageUrl) {
      // URL-based main image — same CRM sync use case as createProduct above.
      const uploaded = await uploadUrlToImageKit(req.body.imageUrl, "/lapshark/products");
      product.image = uploaded.url;
    }

    //
    // 2️⃣ GALLERY IMAGES
    //
    let galleryImages: string[] = product.images || [];

    // Frontend sends remaining old images
    if (req.body.existingImages) {
      try {
        const parsed = typeof req.body.existingImages === 'string'
          ? JSON.parse(req.body.existingImages)
          : req.body.existingImages;
        if (Array.isArray(parsed)) {
          galleryImages = parsed;
        }
      } catch (err) {
        console.error("❌ Invalid existingImages JSON", err);
      }
    }

    // Upload NEW gallery images to ImageKit. These two sources (freshly
    // uploaded files vs. already-hosted URLs, e.g. from the processed-image
    // flow or the CRM sync) can both be present in the same request, so both
    // are appended rather than one gating the other.
    if (files?.images?.length) {
      const uploadedGallery = await Promise.all(
        files.images.map((file) =>
          uploadToImageKit(file, "/lapshark/products/gallery")
        )
      );

      galleryImages = [...galleryImages, ...uploadedGallery.map(r => r.url)];
    }
    if (req.body.imageUrls) {
      // URL-based gallery images — same CRM sync use case as createProduct.
      const urls: string[] = typeof req.body.imageUrls === 'string' ? JSON.parse(req.body.imageUrls) : req.body.imageUrls;
      const uploadedGallery = await Promise.all(urls.map((u) => uploadUrlToImageKit(u, "/lapshark/products/gallery")));
      galleryImages = [...galleryImages, ...uploadedGallery.map((r) => r.url)];
    }

    product.images = galleryImages;

    //
    // 3️⃣ Parse JSON fields and ASSIGN them back to product
    //
    if (typeof req.body.specs === "string") {
      try {
        product.specs = JSON.parse(req.body.specs);
      } catch (err) {
        console.error("Invalid specs JSON", err);
      }
    } else if (typeof req.body.specs === "object") {
      product.specs = req.body.specs;
    }


    if (req.body.configOptions) {
      try {
        product.configOptions = JSON.parse(req.body.configOptions);
      } catch (err) {
        console.error("Invalid configOptions JSON", err);
      }
    }

    //
    // 4️⃣ Update text & numeric fields
    //
    if (req.body.title !== undefined) product.title = req.body.title;
    if (req.body.description !== undefined) product.description = req.body.description;
    if (req.body.brand !== undefined) product.brand = req.body.brand;
    if (req.body.category !== undefined) product.category = req.body.category;
    if (req.body.condition !== undefined) product.condition = req.body.condition;
    if (req.body.useCases !== undefined) product.useCases = JSON.parse(req.body.useCases) as any;
    if (req.body.tags !== undefined) product.tags = JSON.parse(req.body.tags) as any;
    if (req.body.performanceTier !== undefined) product.performanceTier = (req.body.performanceTier || undefined) as any;
    if (req.body.qualityReport !== undefined) product.qualityReport = JSON.parse(req.body.qualityReport) as any;
    if (req.body.productId !== undefined) product.productId = req.body.productId;
    if (req.body.slug !== undefined) product.slug = req.body.slug;
    // Backfill only. An existing slug is never regenerated on edit: changing a
    // live URL breaks inbound links and loses whatever ranking it has earned.
    if (!product.slug || !String(product.slug).trim()) {
      product.slug = await uniqueSlug(product.title, String(product._id));
    }
    if (req.body.price !== undefined) product.price = Number(req.body.price);
    if (req.body.discountPercent !== undefined) product.discountPercent = Number(req.body.discountPercent);
    if (req.body.stock !== undefined) product.stock = Number(req.body.stock);
    if (req.body.finalPrice !== undefined) product.finalPrice = Number(req.body.finalPrice);
    if (req.body.rating !== undefined) product.rating = Number(req.body.rating);
    if (req.body.reviews !== undefined) product.reviews = Number(req.body.reviews);
    if (req.body.weightKg !== undefined) product.weightKg = Number(req.body.weightKg);
    if (req.body.lengthCm !== undefined) product.lengthCm = Number(req.body.lengthCm);
    if (req.body.widthCm !== undefined) product.widthCm = Number(req.body.widthCm);
    if (req.body.heightCm !== undefined) product.heightCm = Number(req.body.heightCm);

    //
    // 5️⃣ Boolean fields
    //
    if (req.body.isNewItem !== undefined) product.isNewItem = req.body.isNewItem === "true";
    if (req.body.isTrending !== undefined) product.isTrending = req.body.isTrending === "true";
    if (req.body.isBestDeal !== undefined) product.isBestDeal = req.body.isBestDeal === "true";

    //
    // 6️⃣ Save updated product
    //
    const updated = await product.save();

    console.log("✅ Product updated:", updated._id);
    res.json(updated);
  } catch (error: any) {
    console.error("❌ Error updating product:", error);
    res.status(400).json({
      message: "Error updating product",
      error: error.message,
    });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const product = await Product.findById(req.params.id);
    if (product) {
      // Delete main image
      if (product.image && product.image.startsWith('/uploads/')) {
        const imagePath = path.join(__dirname, '../..', product.image);
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
        }
      }

      // Delete gallery images
      if (product.images && product.images.length > 0) {
        product.images.forEach(img => {
          if (img.startsWith('/uploads/')) {
            const imgPath = path.join(__dirname, '../..', img);
            if (fs.existsSync(imgPath)) {
              fs.unlinkSync(imgPath);
            }
          }
        });
      }

      await product.deleteOne();
      res.json({ message: 'Product removed' });
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// Multipart fields arrive as strings — `settings` is sent as a JSON string
// when present (mirrors how `viewType` is just a plain field). Invalid JSON
// is treated as "no overrides" rather than a hard error, since composition
// overrides are optional.
function parseSettingsField(raw: unknown): Partial<ViewPreset> | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'object') return raw as Partial<ViewPreset>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Runs a picked file (or an already-hosted image, for reprocessing) through
// PhotoRoom background removal + view-preset-driven studio compositing, then
// uploads the result to ImageKit. Called by the admin form the instant an
// image is picked, before the product itself is saved — the returned URL is
// what createProduct/updateProduct receive via imageUrl/imageUrls.
export const processImage = async (req: Request, res: Response) => {
  try {
    let inputBuffer: Buffer;
    let mimeType: string;

    if (req.file) {
      inputBuffer = req.file.buffer;
      mimeType = req.file.mimetype;
    } else if (req.body.imageUrl) {
      const fetched = await fetch(req.body.imageUrl);
      if (!fetched.ok) throw new Error(`Could not fetch source image (${fetched.status})`);
      inputBuffer = Buffer.from(await fetched.arrayBuffer());
      mimeType = fetched.headers.get('content-type') || 'image/jpeg';
    } else {
      return res.status(400).json({ message: 'No image file or imageUrl provided' });
    }

    const viewType: ProductViewType = req.body.viewType in VIEW_PRESETS ? req.body.viewType : 'custom';
    const settings = parseSettingsField(req.body.settings);

    const result = await processProductImage({ input: inputBuffer, mimeType, viewType, settings });
    const uploaded = await uploadBufferToImageKit(result.buffer, '/lapshark/products');
    res.json({
      url: uploaded.url,
      width: uploaded.width,
      height: uploaded.height,
      viewType: result.viewType,
      appliedSettings: { scale: result.appliedScale, position: result.appliedPosition },
    });
  } catch (error: any) {
    console.error('Error processing image:', error);
    res.status(500).json({ message: 'Image processing failed', error: error.message });
  }
};