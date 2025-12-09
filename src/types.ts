
export enum Category {
  BUSINESS = 'Business Laptops',
  GAMING = 'Gaming Laptops',
  ULTRABOOKS = 'Ultrabooks',
  WORKSTATIONS = 'Workstations',
  STUDENT = 'Student & Home',
  ACCESSORIES = 'Accessories'
}

export interface Product {
  id: string;                 // Use "id" because your table & edit modal use product.id
  productId?: string;         // Optional backend productId (if needed)
  originalId?: string;

  title: string;
  brand: string;
  category: Category;
  description: string;

  specs: {
    processor?: string;
    ram?: string;
    storage?: string;
    display?: string;
    graphics?: string;
    os?: string;
  };

  rating: number;
  reviews: number;

  price: number;
  discountPercent: number;
  finalPrice: number;
  stock: number;

  image: string;         // Main image
  images?: string[];     // Gallery images array

  // Flags
  isNew?: boolean;
  isNewItem?: boolean;   // Needed because your form uses this
  isTrending?: boolean;
  isBestDeal?: boolean;

  condition?: "Like New" | "Excellent" | "Good";
}


export interface CartItem extends Product {
  quantity: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'customer';
  phone?: string;
  address?: string;
  totalSpent?: number;
  ordersCount?: number;
  joinedDate?: string;
  status?: 'active' | 'blocked';
}

export interface Order {
  orderId: string;
  customerName: string;
  customerEmail?: string;
  userId?: string;
  date: string;
  total: number;
  status: 'Pending' | 'Processing' | 'Shipped' | 'Delivered' | 'Cancelled';
  paymentStatus: 'Paid' | 'Pending' | 'Failed';
  paymentMethod: 'Razorpay' | 'COD' | 'Card';
  items: CartItem[];
  shippingAddress?: string;
}

export interface Coupon {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  minOrderValue: number;
  expiryDate: string;
  usageLimit: number;
  usedCount: number;
  isActive: boolean;
}

export interface SiteConfig {
  hero: {
    title: string;
    subtitle: string;
    image: string;
    badgeText: string;
  };
  banners: Array<{
    id: string;
    title: string;
    desc: string;
    image: string;
    link: string;
    bg: string;
    accent: string;
  }>;
  sections: {
    hero: boolean;
    brands: boolean;
    trending: boolean;
    flashSale: boolean;
    comparison: boolean;
    emi: boolean;
    explore: boolean;
    blogs: boolean;
    services: boolean;
  };
  contact: {
    phone: string;
    email: string;
    address: string;
  };
}
