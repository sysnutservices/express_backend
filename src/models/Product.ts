import mongoose, { Document, Schema } from "mongoose";

export interface IConfigOption {
  label: string;
  value: string;
  price: number;
}

export interface IProduct extends Document {
  productId: string;
  title: string;
  slug?: string;
  brand: string;
  category: string;
  description: string;
  specs: Record<string, string>;
  rating: number;
  reviews: number;
  price: number;
  discountPercent: number;
  finalPrice: number;
  stock: number;
  image: string;
  images: string[];
  isNewItem: boolean;
  isTrending: boolean;
  isBestDeal: boolean;
  condition: string;

  configOptions: {
    ram: IConfigOption[];
    storage: IConfigOption[];
    warranty: IConfigOption[];
  };
}

export const DEFAULT_CONFIG_OPTIONS = {
  ram: [
    { label: "8GB RAM", value: "8GB", price: 0 },
    { label: "16GB RAM", value: "16GB", price: 4000 },
    { label: "32GB RAM", value: "32GB", price: 8000 },
  ],
  storage: [
    { label: "256GB SSD", value: "256GB", price: 0 },
    { label: "512GB SSD", value: "512GB", price: 3000 },
    { label: "1TB SSD", value: "1TB", price: 6000 },
  ],
  warranty: [
    { label: "6 Months Warranty", value: "6 Months", price: 0 },
    { label: "1 Year Warranty", value: "1 Year", price: 1500 },
    { label: "2 Year Warranty", value: "2 Year", price: 2999 },
  ],
};

export const Category = {
  BUSINESS: "Business Laptops",
  GAMING: "Gaming Laptops",
  ULTRABOOKS: "Ultrabooks",
  WORKSTATIONS: "Workstations",
  STUDENT: "Student & Home",
  ACCESSORIES: "Accessories",
} as const;

const ConfigOptionSchema = new Schema<IConfigOption>(
  {
    label: String,
    value: String,
    price: Number,
  },
  { _id: false }
);

const ProductSchema: Schema<IProduct> = new Schema(
  {
    productId: { type: String, required: true },
    // Indexed: every product page render looks the product up by slug, so this
    // is the SSR hot path. Unique + sparse so two products can never claim the
    // same URL (duplicate content), while legacy rows without a slug still load.
    // Verified zero duplicates and zero missing slugs across the catalogue
    // before enabling this — a violation would fail index creation on startup.
    slug: { type: String, index: true, unique: true, sparse: true },
    title: { type: String, required: true },
    brand: { type: String, required: true },

    category: {
      type: String,
      required: true,
      enum: Object.values(Category),
    },

    description: { type: String, required: true },
    specs: {
      processor: { type: String },
      ram: { type: String },
      storage: { type: String },
      display: { type: String },
      graphics: { type: String },
      os: { type: String },
    },

    rating: { type: Number, default: 0 },
    reviews: { type: Number, default: 0 },

    price: { type: Number, required: true },
    discountPercent: { type: Number, default: 0 },
    finalPrice: { type: Number, required: true },
    stock: { type: Number, default: 0 },

    image: { type: String, required: true },
    images: [{ type: String }],

    isNewItem: { type: Boolean, default: false },
    isTrending: { type: Boolean, default: false },
    isBestDeal: { type: Boolean, default: false },

    condition: {
      type: String,
      default: "Excellent",
    },

    // ⭐ Added CONFIG inside product
    configOptions: {
      ram: {
        type: [ConfigOptionSchema],
        default: () => DEFAULT_CONFIG_OPTIONS.ram,
      },
      storage: {
        type: [ConfigOptionSchema],
        default: () => DEFAULT_CONFIG_OPTIONS.storage,
      },
      warranty: {
        type: [ConfigOptionSchema],
        default: () => DEFAULT_CONFIG_OPTIONS.warranty,
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model<IProduct>("Product", ProductSchema);
