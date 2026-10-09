// One-off price update for RAM/storage upgrade options on every product
// (2026-10-09): 16GB RAM +₹4,500, 32GB RAM +₹13,500, 512GB SSD +₹4,000,
// 1TB SSD +₹9,000. Matches Product.ts's DEFAULT_CONFIG_OPTIONS, which new
// products get.
//
// The first option in each list is the laptop's base config — it's selected
// by default and its price is added on top of finalPrice like any other
// option — so it's left alone even when it's one of these sizes (a laptop
// that ships with 16GB must not cost ₹4,500 more at its base price).
//
// Product pages, carts and checkout all price from the live product, so the
// new prices apply everywhere as soon as this runs; already-placed orders
// keep the price they were charged.
//
// Dry run (prints changes, writes nothing):  node dist/scripts/setConfigPrices.js
// Apply:                                     node dist/scripts/setConfigPrices.js --apply
import mongoose from "mongoose";
import connectDB from "../config/db";
import Product from "../models/Product";

const APPLY = process.argv.includes("--apply");
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toUpperCase();

const PRICES: Record<"ram" | "storage", Record<string, number>> = {
    ram: { "16GB": 4500, "32GB": 13500 },
    storage: { "512GB": 4000, "1TB": 9000, "1024GB": 9000 },
};

const run = async () => {
    await connectDB();
    const products = await Product.find({}).lean();
    let changedProducts = 0;

    for (const p of products as any[]) {
        const set: Record<string, any> = {};
        const lines: string[] = [];

        for (const key of ["ram", "storage"] as const) {
            const opts: any[] = p.configOptions?.[key] || [];
            const next = opts.map((o, i) => {
                const price = PRICES[key][norm(o.value)];
                if (price === undefined || o.price === price) return o;
                if (i === 0) {
                    lines.push(`    ${key}: "${o.label}" is the base config — kept at ₹${o.price || 0}`);
                    return o;
                }
                lines.push(`    ${key}: "${o.label}" ₹${o.price || 0} -> ₹${price}`);
                return { ...o, price };
            });
            if (next.some((o, i) => o !== opts[i])) set[`configOptions.${key}`] = next;
        }

        if (!lines.length) continue;
        console.log(`${p.title} [${p.slug}]`);
        lines.forEach((l) => console.log(l));
        if (!Object.keys(set).length) continue;
        changedProducts++;
        if (APPLY) await Product.updateOne({ _id: p._id }, { $set: set });
    }

    console.log(`\n${changedProducts} of ${products.length} products ${APPLY ? "updated" : "would change (dry run — rerun with --apply)"}.`);
    await mongoose.disconnect();
};

run().catch(async (err) => {
    console.error("❌ setConfigPrices failed", err);
    await mongoose.disconnect();
    process.exit(1);
});
