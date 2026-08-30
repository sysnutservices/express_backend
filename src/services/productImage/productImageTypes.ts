import sharp from "sharp";
import { ProductViewType } from "../imageProcessing";

// The image-type taxonomy the new prompt system is built around. Distinct
// from ProductViewType (imageProcessing.ts's 11-value enum, chosen by the
// admin in the workflow UI) — this is the coarser category the editing
// PROMPT actually needs to adapt on. detectImageType() below maps one to
// the other rather than asking the admin to pick twice.
export type ProductImageType =
  | "OPEN_LAPTOP_SCREEN_ON"
  | "OPEN_LAPTOP_SCREEN_OFF"
  | "CLOSED_LAPTOP_FRONT"
  | "CLOSED_LAPTOP_BACK"
  | "SIDE_VIEW"
  | "KEYBOARD_CLOSEUP"
  | "SCREEN_CLOSEUP"
  | "OTHER_PRODUCT_VIEW";

// Base category per admin-selected view type — everything not open/closed/
// side/closeup falls back to OTHER_PRODUCT_VIEW rather than being forced
// into a category it doesn't belong to.
const VIEW_TYPE_TO_BASE: Record<ProductViewType, ProductImageType | "OPEN_LAPTOP"> = {
  open_front: "OPEN_LAPTOP",
  open_angle: "OPEN_LAPTOP",
  closed_top: "CLOSED_LAPTOP_FRONT",
  closed_angle: "CLOSED_LAPTOP_FRONT",
  closed_rear: "CLOSED_LAPTOP_BACK",
  bottom: "OTHER_PRODUCT_VIEW",
  left_side: "SIDE_VIEW",
  right_side: "SIDE_VIEW",
  ports: "OTHER_PRODUCT_VIEW",
  detail: "OTHER_PRODUCT_VIEW",
  custom: "OTHER_PRODUCT_VIEW",
};

// Rough, cheap on/off signal — NOT a real vision classifier. Samples the
// upper-center region of the frame (where an open laptop's screen sits in
// every one of the view types that reach here) and checks whether it's
// dark (screen off) or has real brightness/variance (screen on, showing a
// desktop/wallpaper/lock screen). A genuinely reliable classifier would need
// the segmented product mask or a vision model call; this heuristic runs on
// the raw original before any segmentation, so it stays a coarse signal —
// good enough to pick between two prompt variants, not a guarantee.
const SCREEN_OFF_MEAN_THRESHOLD = 45;

async function detectScreenState(originalBuffer: Buffer): Promise<"on" | "off" | "unknown"> {
  try {
    const meta = await sharp(originalBuffer).metadata();
    if (!meta.width || !meta.height) return "unknown";
    const region = await sharp(originalBuffer)
      .extract({
        left: Math.round(meta.width * 0.3),
        top: Math.round(meta.height * 0.15),
        width: Math.round(meta.width * 0.4),
        height: Math.round(meta.height * 0.35),
      })
      .stats();
    const mean = region.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
    return mean < SCREEN_OFF_MEAN_THRESHOLD ? "off" : "on";
  } catch {
    return "unknown";
  }
}

// Called once per ai_edit attempt, before the OpenAI request is built, so
// the prompt can adapt to what's actually in the photo instead of forcing
// every open-laptop shot into one assumption.
export async function detectImageType(viewType: ProductViewType, originalBuffer: Buffer): Promise<ProductImageType> {
  const base = VIEW_TYPE_TO_BASE[viewType] ?? "OTHER_PRODUCT_VIEW";
  if (base !== "OPEN_LAPTOP") return base;
  const screenState = await detectScreenState(originalBuffer);
  return screenState === "off" ? "OPEN_LAPTOP_SCREEN_OFF" : "OPEN_LAPTOP_SCREEN_ON";
}
