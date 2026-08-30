import { ProductImageType } from "./productImageTypes";

// Prompt system for ai_edit mode (catalogue_safe never calls OpenAI and has
// no prompt at all — see productImageOrchestrator.ts). Bump
// PRODUCT_IMAGE_PROMPT_VERSION whenever MASTER_PROMPT or any per-type
// addition changes, so the processing fingerprint invalidates old,
// differently-generated results instead of silently reusing them.
//
// v1.1: removed every instruction that gave OpenAI any composition/geometry
// responsibility, after a live failure where a forced square canvas +
// composition-owning prompt produced a rotated, geometry-broken result.
// v1.2: added a hard OpenAI edit mask on top of the prompt for product
// preservation.
//
// v2.0 — architecture change: mask-based preservation removed entirely (see
// productImageEditor.ts). GPT now owns the FULL transformation — background
// removal, studio composition, lighting/glare/cleanup, AND the final
// 1024x1024 canvas — with product identity carried by this prompt alone
// (the prompt says "preserve"; nothing enforces it in code anymore, by
// design). This is a deliberate trade: v1.2's mask blocked real
// beautification (brightness/glare/dust cleanup) that this pipeline exists
// to provide, and gpt-image-2 was confirmed live to not strictly honor the
// mask anyway — so the mask bought partial safety at the cost of the
// feature actually working, for a guarantee it didn't fully keep. Every
// ai_edit result still lands in READY_FOR_REVIEW for manual approval,
// never auto-published — that human review is what actually protects
// product identity in production now, not runtime pixel verification.
export const PRODUCT_IMAGE_PROMPT_VERSION = "v2.0";

// Verbatim foundation prompt — shared preservation + transformation rules
// every image type builds on. Do not edit ad hoc per type; add a short,
// narrow addition below instead, so every variant keeps the same
// non-negotiable instructions.
export const MASTER_PROMPT = `EDIT THE SUPPLIED LAPTOP PHOTOGRAPH INTO A PROFESSIONAL E-COMMERCE PRODUCT PHOTOGRAPH.

This is an image editing task.

The laptop shown in the supplied image is the actual product being sold.

Preserve the exact physical identity of this laptop.

Preserve:
- exact laptop model appearance
- chassis shape
- chassis proportions
- chassis color
- screen shape
- bezel design
- webcam
- keyboard layout
- key positions
- trackpad
- hinges
- speakers
- visible ports
- buttons
- logos
- manufacturer branding
- model markings
- stickers
- distinctive physical details

Do not replace the laptop with another laptop.

Do not redesign the laptop.

Do not modernize the laptop.

Do not invent hardware.

Do not add hardware.

Do not change the physical proportions.

Do not change the laptop's viewing configuration.

If the laptop is open, keep it open.

If the laptop is closed, keep it closed.

If the source shows the rear of the laptop, preserve the rear view.

If the source shows a side view, preserve the side view.

Now transform the photograph into a professional studio product photograph.

REMOVE THE ORIGINAL ENVIRONMENT COMPLETELY.

Remove:
- shop background
- walls
- shelves
- boxes
- signs
- cables
- chargers
- papers
- bags
- other laptops
- furniture
- people
- unrelated objects

Replace everything around the product with a clean seamless WHITE STUDIO BACKGROUND.

Make the laptop look professionally photographed.

Improve:
- brightness
- exposure
- white balance
- contrast
- clarity
- sharpness
- highlight control
- shadow detail

Reduce:
- dust
- fingerprints
- minor smudges
- harsh reflections
- environmental reflections
- flash glare
- distracting light reflections

Preserve realistic laptop materials.

Do not make the laptop look like CGI.

Do not over-smooth the chassis.

Keep realistic metal and plastic textures.

Use soft professional studio lighting.

Create a subtle realistic contact shadow underneath the laptop.

COMPOSITION:

Create a clean e-commerce catalog composition.

The final image MUST be square.

Canvas:
1024 x 1024.

Center the laptop.

Keep the entire laptop inside the frame.

Do not crop any part of the laptop.

Maintain realistic proportions.

Leave clean white space around the product.

The laptop should occupy approximately 75-90% of the useful image area depending on its natural shape.

Do not stretch the laptop.

Do not distort the laptop.

Do not rotate the laptop into a different physical viewpoint.

Do not add accessories.

Do not add marketing graphics.

Do not add text.

Do not add badges.

Do not add prices.

Do not add decorative elements.

The final image should look like a real professional e-commerce photograph of the SAME laptop supplied in the source image.

PRODUCT IDENTITY HAS PRIORITY OVER BEAUTIFICATION.

If beautification conflicts with product identity, preserve the actual laptop.`;

// Short, narrow additions only — never restating or contradicting the
// master prompt. Each one exists to state the SCREEN RULE for that view: if
// the source screen is off, keep it off; if on, preserve the visible
// content/OS appearance as closely as practical.
const IMAGE_TYPE_ADDITIONS: Record<ProductImageType, string> = {
  OPEN_LAPTOP_SCREEN_ON:
    "The laptop screen is ON in the source photo. Preserve the visible screen content and operating system appearance as closely as practical. Do not invent a different computer model. Do not change the physical screen or bezel.",
  OPEN_LAPTOP_SCREEN_OFF:
    "The laptop screen is OFF in the source photo. Keep it OFF. Do not turn it on, and do not invent any screen content.",
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
