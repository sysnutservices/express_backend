import { Request, Response } from 'express';
import Product from '../models/Product';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { imagekit } from '../services/imagekit';

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

const uploadToImageKit = async (file: Express.Multer.File, folder: string) => {
  const ext = path.extname(file.originalname);

  const filename =
    "product-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;

  const uploaded = await imagekit.upload({
    file: file.buffer,
    fileName: filename,
    folder,
  });

  return uploaded.url;
};
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


export const createProduct = async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // Get main image
    let mainImage = "";
    let galleryImages: string[] = [];

    // MAIN IMAGE UPLOAD
    if (files?.image?.[0]) {
      mainImage = await uploadToImageKit(
        files.image[0],
        "/lapshark/products"
      );
    }

    // GALLERY IMAGE UPLOAD
    if (files?.images?.length) {
      galleryImages = await Promise.all(
        files.images.map((img) =>
          uploadToImageKit(img, "/lapshark/products/gallery")
        )
      );
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
      image: mainImage,
      images: galleryImages,
      specs: req.body.specs ? JSON.parse(req.body.specs) : {},
      configOptions: req.body.configOptions ? JSON.parse(req.body.configOptions) : undefined,
      isNewItem: req.body.isNewItem === 'true',
      isTrending: req.body.isTrending === 'true',
      isBestDeal: req.body.isBestDeal === 'true',
    };

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
      product.image = await uploadToImageKit(
        files.image[0],
        "/lapshark/products"
      );
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

    // Upload NEW gallery images to ImageKit
    if (files?.images?.length) {
      const uploadedGallery = await Promise.all(
        files.images.map((file) =>
          uploadToImageKit(file, "/lapshark/products/gallery")
        )
      );

      galleryImages = [...galleryImages, ...uploadedGallery];
    }

    product.images = galleryImages;

    //
    // 3️⃣ Parse JSON fields and ASSIGN them back to product
    //
    if (req.body.specs) {
      try {
        product.specs = JSON.parse(req.body.specs);
      } catch (err) {
        console.error("Invalid specs JSON", err);
      }
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
    if (req.body.productId !== undefined) product.productId = req.body.productId;

    if (req.body.price !== undefined) product.price = Number(req.body.price);
    if (req.body.discountPercent !== undefined) product.discountPercent = Number(req.body.discountPercent);
    if (req.body.stock !== undefined) product.stock = Number(req.body.stock);
    if (req.body.finalPrice !== undefined) product.finalPrice = Number(req.body.finalPrice);
    if (req.body.rating !== undefined) product.rating = Number(req.body.rating);
    if (req.body.reviews !== undefined) product.reviews = Number(req.body.reviews);

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