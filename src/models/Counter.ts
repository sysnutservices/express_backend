import mongoose, { Schema } from "mongoose";

// Backs human-readable sequential IDs (order numbers, etc.) — one document
// per counter key, atomically incremented via findOneAndUpdate's $inc so
// concurrent checkouts never hand out the same number (a read-then-write
// counter would race under real traffic).
interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model<ICounter>("Counter", counterSchema);

export async function nextSeq(key: string): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return counter.seq;
}

export default Counter;
