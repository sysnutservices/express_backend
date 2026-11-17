import Product from "../../models/Product";
import { Types } from "mongoose";
import DealerOrder, { IDealerOrder } from "../models/DealerOrder";

// Dealer orders take stock off when they are PLACED (unlike retail, which
// deducts on payment): payment is a manual bank transfer or cash, which can
// take a day, and the laptops must not be sold on the website meanwhile.
// Each line is a conditional decrement, so two buyers can never take the
// last unit; on any failure the lines already taken are put back.
export async function reserveStock(lines: { productId: string; quantity: number; title: string }[]): Promise<{ ok: true } | { ok: false; title: string }> {
  const taken: { productId: string; quantity: number }[] = [];
  for (const l of lines) {
    const r = await Product.updateOne({ _id: l.productId, stock: { $gte: l.quantity } }, { $inc: { stock: -l.quantity } });
    if (r.modifiedCount !== 1) {
      for (const t of taken) await Product.updateOne({ _id: t.productId }, { $inc: { stock: t.quantity } });
      return { ok: false, title: l.title };
    }
    taken.push({ productId: l.productId, quantity: l.quantity });
  }
  return { ok: true };
}

// Puts a cancelled order's laptops back, exactly once (the stockReserved
// flag is claimed atomically).
export async function releaseStock(orderId: Types.ObjectId | string): Promise<void> {
  const order = await DealerOrder.findOneAndUpdate({ _id: orderId, stockReserved: true }, { $set: { stockReserved: false } }, { new: false }).lean<IDealerOrder>();
  if (!order) return;
  for (const l of order.lines) await Product.updateOne({ _id: l.productId }, { $inc: { stock: l.quantity } });
}
