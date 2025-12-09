import mongoose, { Document, Schema } from 'mongoose';

export interface ISiteConfig extends Document {
  hero: {
    desktop: string,
    mobile: string,
    tablet: string,

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

const SiteConfigSchema: Schema = new Schema({
  hero: {
    desktop: String,
    mobile: String,
    tablet: String,
  },
  banners: [{
    id: String,
    title: String,
    desc: String,
    image: String,
    link: String,
    bg: String,
    accent: String
  }],
  sections: {
    hero: { type: Boolean, default: true },
    brands: { type: Boolean, default: true },
    trending: { type: Boolean, default: true },
    flashSale: { type: Boolean, default: true },
    comparison: { type: Boolean, default: true },
    emi: { type: Boolean, default: true },
    explore: { type: Boolean, default: true },
    blogs: { type: Boolean, default: true },
    services: { type: Boolean, default: true }
  },
  contact: {
    phone: String,
    email: String,
    address: String
  }
}, {
  timestamps: true
});

// Ensure only one config document exists
export default mongoose.model<ISiteConfig>('SiteConfig', SiteConfigSchema);