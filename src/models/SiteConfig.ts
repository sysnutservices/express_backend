import mongoose, { Document, Schema } from 'mongoose';

export interface ISiteConfig extends Document {
  hero: {
    title: { type: String, required: true },
    subtitle: { type: String, required: true },
    image: { type: String, default: '' },
    badgeText: { type: String, default: '' },
    imageMobile: { type: String, default: '' },
    imageTablet: { type: String, default: '' },
    imageDesktop: { type: String, default: '' },
    activeHeroTemplate: { type: String, default: 'default' },
    slides: Array<{
      href: string;
      imageDesktop: string;
      imageTablet: string;
      imageMobile: string;
    }>;
  },
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
  analytics: {
    gaMeasurementId?: string;
    metaPixelId?: string;
    clarityProjectId?: string;
    // Secret — adminController.getSiteConfig strips this from every
    // response (both the public /site-config route and the technically-
    // unauthenticated GET /admin/site-config route serve this same
    // document). Only ever written via the protect+admin PUT.
    metaCapiAccessToken?: string;
  };
}

const SiteConfigSchema = new Schema(
  {
    hero: {
      title: { type: String, required: true },
      subtitle: { type: String, required: true },
      image: { type: String, default: "" },
      badgeText: { type: String, default: "" },

      imageMobile: { type: String, default: "" },
      imageTablet: { type: String, default: "" },
      imageDesktop: { type: String, default: "" },

      activeHeroTemplate: { type: String, default: "default" },

      // Multiple hero banners shown as a slideshow. Legacy single image/imageDesktop/
      // imageTablet/imageMobile fields above stay as a fallback for configs saved
      // before this existed.
      slides: [
        {
          href: { type: String, default: "/products" },
          imageDesktop: String,
          imageTablet: String,
          imageMobile: String,
        }
      ]
    },

    banners: [
      {
        id: String,
        title: String,
        desc: String,
        image: String,
        link: String,
        bg: String,
        accent: String
      }
    ],

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
    },

    analytics: {
      gaMeasurementId: { type: String, default: "" },
      metaPixelId: { type: String, default: "" },
      clarityProjectId: { type: String, default: "" },
      metaCapiAccessToken: { type: String, default: "" },
    }
  },
  { timestamps: true }
);


// Ensure only one config document exists
export default mongoose.model<ISiteConfig>('SiteConfig', SiteConfigSchema);