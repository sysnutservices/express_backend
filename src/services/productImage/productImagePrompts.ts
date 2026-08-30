import { ProductImageType } from "./productImageTypes";

// New prompt system for ai_edit mode (catalogue_safe never calls OpenAI and
// has no prompt at all — see productImageOrchestrator.ts). Bump this
// whenever MASTER_PROMPT or any per-type addition changes, so the
// processing fingerprint invalidates old, differently-generated results
// instead of silently reusing them.
//
// v1.1: removed every instruction that gave OpenAI any composition/geometry
// responsibility ("correct perspective and alignment", "center the product
// in the frame") after a live failure — a landscape/portrait source photo
// came back as a vertically-rotated device with the keyboard and trackpad
// gone. Composition/orientation/proportions are Sharp's job everywhere else
// in this pipeline (composeStudioImage) and now explicitly stay Sharp's job
// here too; productImageEditor.ts also hard-rejects (and retries) any
// result whose orientation doesn't match the source, as a backstop.
//
// v1.2: prompt text itself is unchanged, but product preservation now also
// rides on a hard OpenAI edit mask (see productImageEditor.ts's
// buildPreserveMask) instead of the prompt alone — a materially different
// generation, so old v1.1 results must not be reused as if identical.
export const PRODUCT_IMAGE_PROMPT_VERSION = "v1.2";

// Verbatim foundation prompt — shared preservation rules every image type
// builds on. Do not edit ad hoc per type; add a short, narrow addition below
// instead, so every variant keeps the same non-negotiable guarantees.
export const MASTER_PROMPT = `EDIT THE SUPPLIED PHOTOGRAPH. DO NOT RECREATE THE PRODUCT.

You are editing a real product photograph for a professional e-commerce catalog. Do not generate a replacement product.

Preserve the exact physical identity, orientation, viewpoint, proportions and visible hardware of the laptop shown in the source image.

Do not rotate the laptop.
Do not change the opening angle.
Do not remove the keyboard.
Do not remove the trackpad.
Do not replace the laptop with another laptop.
Do not reinterpret the product.
Do not generate missing hardware.

If the source laptop is open, the output must be open. If the source laptop is closed, the output must stay closed. If the source is photographed horizontally, the output must remain horizontal — never turn it into a vertical/portrait object, and never reinterpret it as a tablet, monitor, screen, or generic electronic device.

Preserve:
- exact laptop model appearance
- body shape
- chassis proportions
- chassis color
- keyboard layout
- trackpad
- hinges
- webcam
- bezels
- logos
- branding
- stickers
- model markings
- ports
- physical buttons
- distinctive hardware details

Do not redesign, replace, modernize, or invent hardware.

Remove the original environmental background and replace it with a clean seamless white studio background.

Remove unrelated objects including:
walls, shelves, boxes, cables, chargers, papers, other laptops, bags, furniture, people and shop signage.

Clean the product photograph:
remove distracting dust, fingerprints, minor smudges, harsh glare and unwanted environmental reflections while preserving realistic material texture and legitimate product details.

Improve:
exposure,
brightness,
contrast,
white balance,
clarity,
sharpness,
highlight control,
shadow detail.

Use soft professional studio lighting.

Keep realistic product materials.

Add only a subtle realistic contact shadow beneath the product.

The final image must look like a professionally photographed real laptop, not a CGI render.

Do not crop the laptop.
Do not stretch the laptop.
Do not add text.
Do not add marketing graphics.
Do not add badges.
Do not add prices.
Do not add decorative elements.
Do not add accessories.

Composition, framing and final canvas size are handled separately after your edit — do not resize, recompose, crop, rotate, or reposition the product to fit any particular canvas shape. Edit the photograph in its own original orientation and proportions.

Most important:
the output must remain the SAME physical laptop shown in the input image, in the same orientation and configuration.`;

// Short, narrow additions only — never restating or contradicting the
// master prompt, never inviting beautification beyond what it already asks
// for. Each one exists to stop a single specific failure mode for that view.
const IMAGE_TYPE_ADDITIONS: Record<ProductImageType, string> = {
  OPEN_LAPTOP_SCREEN_ON:
    "The laptop screen is ON in the source photo. Preserve the fact that it is genuinely displaying content — keep the same operating system, wallpaper, and on-screen elements exactly as shown. Do not invent a different desktop or interface. You may improve screen readability (glare, exposure) without changing what is actually displayed.",
  OPEN_LAPTOP_SCREEN_OFF:
    "The laptop screen is OFF in the source photo — it is a dark/black display. Preserve it as an off screen. Do not turn it on, and do not invent any screen content.",
  CLOSED_LAPTOP_FRONT:
    "The laptop is CLOSED in the source photo. Keep it closed. Do not open it or reveal the keyboard/screen.",
  CLOSED_LAPTOP_BACK:
    "This is a closed laptop's REAR view. Keep it closed and keep this rear-facing angle. Preserve all vents, hinges, rear ports and labels exactly.",
  SIDE_VIEW:
    "This is a SIDE profile view of the laptop. Keep this exact side-on angle — do not rotate the product to a front or angled view.",
  KEYBOARD_CLOSEUP:
    "This is a close-up of the keyboard. Preserve the exact key layout, key labels, and trackpad/TrackPoint exactly as shown — do not redesign or relabel any keys.",
  SCREEN_CLOSEUP:
    "This is a close-up of the screen/display. Preserve the exact bezel and any visible screen content exactly as shown — do not invent additional content.",
  OTHER_PRODUCT_VIEW:
    "Preserve the exact viewing angle and framing shown in the source photo. Do not change the physical perspective.",
};

export function buildProductImagePrompt(imageType: ProductImageType): string {
  return `${MASTER_PROMPT}\n\n${IMAGE_TYPE_ADDITIONS[imageType]}`;
}
