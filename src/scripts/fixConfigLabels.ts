// One-off data fix for product config option labels (2026-10-09):
//  - RAM options labelled "8GB Unified" / "16GB Unified Memory" — the admin
//    form's old default template, copied onto every product. "Unified
//    memory" is Apple Silicon terminology, wrong for the Intel Dell/HP/
//    Lenovo/MacBook machines it ended up on. Relabelled "<value> RAM",
//    matching Product.ts's DEFAULT_CONFIG_OPTIONS. Apple Silicon (M1-M4)
//    products are left alone.
//  - Storage labels whose size doesn't match the stored value (e.g. "265GB
//    SSD" on a 256GB option). The value is what's charged and recorded, so
//    the label is the one that's wrong.
// Only labels change — values and prices are untouched, so carts, orders
// and pricing are unaffected.
//
// Dry run (prints changes, writes nothing):  node dist/scripts/fixConfigLabels.js
// Apply:                                     node dist/scripts/fixConfigLabels.js --apply
import mongoose from "mongoose";
import connectDB from "../config/db";
import Product from "../models/Product";

const APPLY = process.argv.includes("--apply");
const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

const fixRam = (opt: any, appleSilicon: boolean) =>
    !appleSilicon && /unified/i.test(opt.label || "") ? `${opt.value} RAM` : opt.label;

const fixStorage = (opt: any) =>
    opt.value && /ssd/i.test(opt.label || "") && !norm(opt.label).includes(norm(opt.value))
        ? `${opt.value} SSD`
        : opt.label;

const run = async () => {
    await connectDB();
    const products = await Product.find({}).lean();
    let changedProducts = 0;

    for (const p of products as any[]) {
        const appleSilicon = /\bM[1-4]\b/.test(p.specs?.processor || "");
        const set: Record<string, any> = {};
        const lines: string[] = [];

        for (const [key, fix] of [["ram", (o: any) => fixRam(o, appleSilicon)], ["storage", fixStorage]] as const) {
            const opts: any[] = p.configOptions?.[key] || [];
            const next = opts.map((o) => ({ ...o, label: fix(o) }));
            next.forEach((o, i) => {
                if (o.label !== opts[i].label) lines.push(`    ${key}: "${opts[i].label}" -> "${o.label}"`);
            });
            if (next.some((o, i) => o.label !== opts[i].label)) set[`configOptions.${key}`] = next;
        }

        if (!lines.length) continue;
        changedProducts++;
        console.log(`${p.title} [${p.slug}]`);
        lines.forEach((l) => console.log(l));
        if (APPLY) await Product.updateOne({ _id: p._id }, { $set: set });
    }

    console.log(`\n${changedProducts} of ${products.length} products ${APPLY ? "updated" : "would change (dry run — rerun with --apply)"}.`);
    await mongoose.disconnect();
};

run().catch(async (err) => {
    console.error("❌ fixConfigLabels failed", err);
    await mongoose.disconnect();
    process.exit(1);
});
