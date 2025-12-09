import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import connectDB from "./config/db";
import Product from "./models/Product";

dotenv.config();

// Helper function to parse CSV
function parseCSV(filePath: string): any[] {
  const csvData = fs.readFileSync(filePath, "utf-8");
  const lines = csvData.split("\n");
  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

  const products = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    // Simple CSV parser (handles quoted fields)
    const values: string[] = [];
    let currentValue = "";
    let insideQuotes = false;

    for (let char of lines[i]) {
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === "," && !insideQuotes) {
        values.push(currentValue.trim().replace(/^"|"$/g, ""));
        currentValue = "";
      } else {
        currentValue += char;
      }
    }
    values.push(currentValue.trim().replace(/^"|"$/g, ""));

    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    products.push(row);
  }

  return products;
}

// Helper to clean HTML and extract text
function cleanHTML(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .replace(/\\n/g, " ")
    .trim();
}

// Extract specs from description
function extractSpecs(description: string): any {
  const specs: any = {
    processor: "",
    ram: "",
    storage: "",
    display: "",
    graphics: "",
    os: "",
  };

  // Extract processor
  const processorMatch = description.match(
    /Intel Core (i[3579]) (\d+)(?:th|st|nd|rd)?\s*Gen/i
  );
  if (processorMatch) {
    specs.processor = `Intel Core ${processorMatch[1]} ${processorMatch[2]}th Gen`;
  }

  // Extract RAM
  const ramMatch = description.match(/(\d+GB)\s*RAM/i);
  if (ramMatch) {
    specs.ram = ramMatch[1];
  }

  // Extract Storage
  const storageMatch = description.match(/(\d+GB|\d+TB)\s*(SSD|HDD|Storage)/i);
  if (storageMatch) {
    specs.storage = `${storageMatch[1]} ${storageMatch[2]}`;
  }

  // Extract Display
  const displayMatch = description.match(/(\d+\.?\d*)"?\s*(HD|FHD|4K)?/i);
  if (displayMatch) {
    specs.display = `${displayMatch[1]}" ${displayMatch[2] || "HD"}`;
  }

  // Extract OS
  if (description.includes("Windows 11")) {
    specs.os = "Windows 11 Pro";
  } else if (description.includes("Windows 10")) {
    specs.os = "Windows 10 Pro";
  }

  return specs;
}

// Parse config options from CSV attributes
function parseConfigOptions(row: any): any {
  const configOptions: any = {
    ram: [],
    storage: [],
    warranty: [
      { label: "1 Year Warranty", value: "1 Year", price: 0 },
      { label: "2 Year Coverage", value: "2 Year", price: 2499 },
      { label: "3 Year Premium", value: "3 Year", price: 4499 },
    ],
  };

  // Parse RAM options
  const ramValues = row["Attribute 1 value(s)"] || "";
  if (ramValues) {
    const rams = ramValues.split(",").map((r: string) => r.trim());
    rams.forEach((ram: string, index: number) => {
      configOptions.ram.push({
        label: `${ram} RAM`,
        value: ram,
        price: index * 4000, // 0, 4000, 8000
      });
    });
  }

  // Parse Storage options
  const storageValues = row["Attribute 2 value(s)"] || "";
  if (storageValues) {
    const storages = storageValues.split(",").map((s: string) => s.trim());
    storages.forEach((storage: string, index: number) => {
      configOptions.storage.push({
        label: `${storage} SSD`,
        value: storage,
        price: index * 3000, // 0, 3000, 6000
      });
    });
  }

  // Fallback defaults if no config found
  if (configOptions.ram.length === 0) {
    configOptions.ram = [
      { label: "8GB RAM", value: "8GB", price: 0 },
      { label: "16GB RAM", value: "16GB", price: 4000 },
      { label: "32GB RAM", value: "32GB", price: 8000 },
    ];
  }

  if (configOptions.storage.length === 0) {
    configOptions.storage = [
      { label: "256GB SSD", value: "256GB", price: 0 },
      { label: "512GB SSD", value: "512GB", price: 3000 },
      { label: "1TB SSD", value: "1TB", price: 6000 },
    ];
  }

  return configOptions;
}

// Extract brand from title
function extractBrand(title: string): string {
  const brands = ["Dell", "HP", "Lenovo", "Apple", "Asus", "Acer", "Microsoft"];
  for (const brand of brands) {
    if (title.toLowerCase().includes(brand.toLowerCase())) {
      return brand;
    }
  }
  return "Generic";
}

// Determine category from title/tags
function determineCategory(title: string, tags: string): string {
  const titleLower = title.toLowerCase();
  const tagsLower = tags.toLowerCase();

  if (
    titleLower.includes("thinkpad") ||
    titleLower.includes("latitude") ||
    titleLower.includes("probook")
  ) {
    return "Business Laptops";
  }

  if (titleLower.includes("gaming") || tagsLower.includes("gaming")) {
    return "Gaming Laptops";
  }

  if (titleLower.includes("ultrabook") || titleLower.includes("macbook")) {
    return "Ultrabooks";
  }

  if (titleLower.includes("workstation")) {
    return "Workstations";
  }

  if (tagsLower.includes("student") || titleLower.includes("student")) {
    return "Student & Home";
  }

  return "Business Laptops"; // Default
}

// Generate slug from title
function generateSlug(title: string, brand: string): string {
  let slug = title.toLowerCase();

  // Remove storage, RAM, years
  slug = slug.replace(/\b(\d+gb|\d+tb|ssd|hdd)\b/g, "");
  slug = slug.replace(/\b(\d+gb ram|\d+gb)\b/g, "");
  slug = slug.replace(/\(\d{4}\)/g, "");
  slug = slug.replace(/\[\d{4}\]/g, "");
  slug = slug.replace(/\s+/g, " ").trim();

  // Convert to slug format
  slug = slug.replace(/[^a-z0-9]+/g, "-");

  // Add brand at the beginning
  const brandSlug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  slug = `${brandSlug}-${slug}`;

  // Clean up
  slug = slug.replace(/^-+|-+$/g, "");

  return slug;
}

// Parse images from CSV
function parseImages(imagesString: string): { main: string; gallery: string[] } {
  if (!imagesString) {
    return {
      main: "/uploads/products/placeholder.jpg",
      gallery: [],
    };
  }

  const imageUrls = imagesString.split(",").map((url) => url.trim());

  // Download and save images locally (simplified - just use URLs for now)
  // In production, you'd download these and save to /uploads/products/

  return {
    main: imageUrls[0] || "/uploads/products/placeholder.jpg",
    gallery: imageUrls.slice(1),
  };
}

async function seedProducts() {
  try {
    await connectDB();

    console.log("🗑️  Clearing existing products...");
    await Product.deleteMany({});

    console.log("📄 Reading CSV file...");
    const csvPath = path.join(
      __dirname,
      "./wc-product-export-6-12-2025-1764999664101.csv"
    );

    const csvProducts = parseCSV(csvPath);
    console.log(`📊 Found ${csvProducts.length} products in CSV`);

    const productsToInsert = [];

    for (const row of csvProducts) {
      const title = row["Name"];
      const sku = row["SKU"];
      const regularPrice = parseFloat(row["Regular price"]) || 0;
      const salePrice = parseFloat(row["Sale price"]) || 0;
      const stock = parseInt(row["Stock"]) || 0;
      const description = cleanHTML(row["Description"]);
      const shortDescription = cleanHTML(row["Short description"]);
      const tags = row["Tags"] || "";
      const imagesString = row["Images"];

      if (!title || !sku) continue;

      // Calculate pricing
      const price = regularPrice;
      const finalPrice = salePrice || regularPrice;
      const discountPercent =
        price > 0 ? Math.round(((price - finalPrice) / price) * 100) : 0;

      // Extract data
      const brand = extractBrand(title);
      const category = determineCategory(title, tags);
      const slug = generateSlug(title, brand);
      const specs = extractSpecs(title + " " + description);
      const configOptions = parseConfigOptions(row);
      const images = parseImages(imagesString);

      // Determine condition
      let condition: "Like New" | "Excellent" | "Good" | "New" = "Excellent";
      if (title.includes("New") && !title.includes("Refurbished")) {
        condition = "New";
      } else if (description.includes("Like New")) {
        condition = "Like New";
      } else if (description.includes("Good")) {
        condition = "Good";
      }

      const product = {
        productId: sku,
        slug: slug,
        title: title,
        brand: brand,
        category: category,
        description: description || shortDescription,
        specs: specs,
        rating: 4.5,
        reviews: Math.floor(Math.random() * 50) + 10,
        price: price,
        discountPercent: discountPercent,
        finalPrice: finalPrice,
        stock: stock || 5,
        image: images.main,
        images: images.gallery,
        isNewItem: condition === "New",
        isTrending: Math.random() > 0.7,
        isBestDeal: discountPercent > 20,
        condition: condition,
        configOptions: configOptions,
      };

      productsToInsert.push(product);
    }

    console.log(`💾 Inserting ${productsToInsert.length} products...`);
    await Product.insertMany(productsToInsert);

    console.log("✅ Products seeded successfully!");
    console.log(`📦 Total products: ${productsToInsert.length}`);

    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding products:", err);
    process.exit(1);
  }
}

seedProducts();