"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const SiteConfigSchema = new mongoose_1.Schema({
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
exports.default = mongoose_1.default.model('SiteConfig', SiteConfigSchema);
