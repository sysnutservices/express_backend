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

  // Drives "Find Your Perfect Laptop" / "Shop by Need" filtering. Deliberately
  // NOT a stored budgetCategory field — that's derivable from finalPrice at
  // query time, and a stored copy would just be one more number to keep in
  // sync (the exact drift problem STORE_POLICIES was built to stop).
  useCases: string[];
  performanceTier?: "basic" | "balanced" | "high-performance";
  // Free-form marketing tags ("best-value", "portable", "long-battery-life")
  // for ProductBadges/recommendation copy — separate from useCases, which is
  // the controlled vocabulary the recommendation engine actually filters on.
  tags: string[];

  // Per-listing inspection results for the "Lapshark Quality Report". All
  // optional and unset by default — see the comment on QualityReportSchema
  // below for why these are never fabricated.
  qualityReport?: {
    batteryHealthPercent?: number;
    storageHealthPercent?: number;
    displayStatus?: "passed" | "minor-wear" | "failed";
    keyboardStatus?: "passed" | "minor-wear" | "failed";
    trackpadStatus?: "passed" | "minor-wear" | "failed";
    webcamStatus?: "passed" | "minor-wear" | "failed";
    speakerStatus?: "passed" | "minor-wear" | "failed";
    microphoneStatus?: "passed" | "minor-wear" | "failed";
    wifiStatus?: "passed" | "minor-wear" | "failed";
    bluetoothStatus?: "passed" | "minor-wear" | "failed";
    portsStatus?: "passed" | "minor-wear" | "failed";
    physicalConditionNotes?: string;
    serialVerified?: boolean;
    technicianChecked?: boolean;
    inspectedAt?: Date;
  };

  // Shipping package dims for Ekart rate/serviceability + shipment creation.
  // Defaulted to a typical boxed-laptop parcel so existing/new products ship
  // correctly with zero admin input; override per-product when it matters
  // (heavier workstations, accessories, etc).
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;

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

// Controlled vocabulary the recommendation engine (lib/product-recommendation.ts
// on the frontend) matches against — keep in sync with USE_CASES there.
export const USE_CASES = [
  "student",
  "office",
  "programming",
  "design",
  "gaming",
  "everyday",
] as const;

const QUALITY_STATUS_VALUES = ["passed", "minor-wear", "failed"] as const;

// Every field here is optional with NO default — an admin who hasn't
// inspected/entered data for a listing gets `undefined`, not a fabricated
// "passed". The Quality Report UI only ever renders a field it actually got
// a value for; everything else falls back to the general 40-point-inspection
// claim, never an invented checkmark or percentage.
//
// This is architected per-listing (on Product), not per-serial-number: this
// schema has a `stock` count, meaning one listing can represent more than
// one physical unit. If Lapshark starts tracking individual units by serial
// number, this belongs on a separate per-unit collection instead — putting
// exact-unit data (a specific battery %, a specific serial) on a
// multi-stock listing would misrepresent every unit that isn't the one
// inspected. Confirm actual stock-per-listing practice before entering real
// numbers here.
const QualityReportSchema = new Schema(
  {
    batteryHealthPercent: { type: Number, min: 0, max: 100 },
    storageHealthPercent: { type: Number, min: 0, max: 100 },
    displayStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    keyboardStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    trackpadStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    webcamStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    speakerStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    microphoneStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    wifiStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    bluetoothStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    portsStatus: { type: String, enum: QUALITY_STATUS_VALUES },
    physicalConditionNotes: { type: String },
    serialVerified: { type: Boolean },
    technicianChecked: { type: Boolean },
    inspectedAt: { type: Date },
  },
  { _id: false }
);

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
      // "New" included alongside the refurbished grades: the admin form
      // (app/admin/(dashboard)/products/page.tsx) already offers it as an
      // option for the rare brand-new accessory/listing.
      type: String,
      enum: ["Like New", "Excellent", "Good", "New"],
      default: "Excellent",
    },

    useCases: {
      type: [{ type: String, enum: USE_CASES }],
      default: [],
      index: true,
    },
    performanceTier: {
      type: String,
      enum: ["basic", "balanced", "high-performance"],
    },
    tags: { type: [String], default: [] },
    qualityReport: { type: QualityReportSchema, default: undefined },

    weightKg: { type: Number, default: 2.5 },
    lengthCm: { type: Number, default: 35 },
    widthCm: { type: Number, default: 25 },
    heightCm: { type: Number, default: 8 },

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
