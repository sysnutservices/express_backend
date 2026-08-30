# AI product-image editing (`ai_edit` mode)

This directory is the prompt/editing system for `ai_edit` mode — the
explicit, opt-in alternative to the default `catalogue_safe` pipeline (real
local segmentation, no OpenAI, never touches product pixels — see the
comment at the top of `../productImageOrchestrator.ts`). `ai_edit` is for
photos `catalogue_safe` can't clean up well enough on its own (messy
backgrounds, real reflections, uneven lighting, dust/smudges) — it costs
money, can alter product pixels, and always lands in `READY_FOR_REVIEW` for
manual approval, never auto-published.

## Configuring `OPENAI_API_KEY`

Server-side only, in the backend's `.env`:

```
OPENAI_API_KEY=sk-...
```

Never `NEXT_PUBLIC_OPENAI_API_KEY` — the frontend never sees this value.
Admins can also set/rotate it from **Admin → Settings → AI Settings**, which
writes to the same `.env` file server-side (`aiSettingsController.ts` +
`utils/envFile.ts`) and never echoes the key back to the browser.

## How an `ai_edit` request works (v2.0 architecture)

1. Admin picks a product image slot, a `viewType`, and mode `ai_edit` in the
   **AI Ecommerce Images** workflow (`ProductImageWorkflow.tsx`) and clicks
   Create/Reprocess.
2. `POST /api/products/images/:rootImageId/process` (`productImageController.
   processRootImage`) reaches `productImageOrchestrator.createEcommerceImage`.
3. `productImageEditor.editProductImage()`:
   - `productImageTypes.detectImageType()` maps the admin's `viewType` to one
     of 8 `ProductImageType`s, disambiguating an open-laptop shot into
     `OPEN_LAPTOP_SCREEN_ON`/`_OFF` via a brightness heuristic on the photo's
     upper-center region (a coarse signal, not a real vision classifier).
   - `productImagePrompts.buildProductImagePrompt()` returns the shared
     `MASTER_PROMPT` plus one short, type-specific addition.
   - `openaiClient.editImage()` calls `openai.images.edit` with
     `model: "gpt-image-2"`, the ORIGINAL photo at full resolution
     (unresized, uncropped), that prompt, `size: "1024x1024"`, and
     `quality: "high"`. One call per attempt, up to 2 retries only for
     transient errors (429/5xx/timeout — never for invalid input or
     content-policy rejections).
4. **gpt-image-2's own 1024x1024 output IS the final product image.** The
   orchestrator uploads it directly as `masterImageUrl`, and Sharp only
   derives the smaller `productImageUrl`/`thumbnailImageUrl` catalogue sizes
   by resizing those exact pixels (`generateVariants`) — never a second,
   independently-generated or recomposed image. No local segmentation runs
   on the AI output; there is no cutout and no transparent master for an
   `ai_edit` result (`cutoutImageUrl`/`transparentMasterUrl` stay `null` —
   the admin UI already treats `transparentMasterUrl` as optional).

### Why no mask, why no local segmentation before or after the OpenAI call

An earlier version (v1.2) built a hard OpenAI edit mask from local
segmentation — opaque over the product, transparent over the background —
and ran local segmentation again on the OpenAI output for the Sharp
recompose step. Both are gone as of v2.0:

- **The mask blocked the beautification this pipeline exists to do.**
  "Opaque = preserve exactly" also means "brightness/glare/dust cleanup
  cannot touch that pixel" — the mask and the feature request were in direct
  conflict.
- **It didn't even reliably work.** A live test against gpt-image-2 (not
  `dall-e-2`, whose edit endpoint this mask behavior comes from) showed it
  changed pixels inside the "preserved" region anyway — including the
  on-screen taskbar clock/date — despite the mask marking that region
  protected. The mask bought partial safety at the cost of the feature
  actually working, for a guarantee gpt-image-2 didn't fully honor.
- **Local segmentation of the AI output only existed to feed the mask-era
  Sharp recompose step.** With gpt-image-2's own 1024x1024 output now being
  the final image directly, there's nothing left to segment or recompose.

Product identity is carried by the prompt alone now (same as v1.1) —
"Preserve the exact physical identity of this laptop," explicit preservation
lists for chassis/keyboard/ports/logos/etc., "PRODUCT IDENTITY HAS PRIORITY
OVER BEAUTIFICATION." Nothing in code enforces this at runtime. **Manual
review before publish is the actual safeguard** — every `ai_edit` result
lands in `READY_FOR_REVIEW`, never auto-published, by design.

## Supported image formats & validation

`upload-original` (the only place a file is actually uploaded) accepts
`image/*` MIME types via `multer`'s file filter in `productController.ts`'s
`upload` config; HEIC gets converted client-side first
(`lib/convertHeic.ts`). There's no separate upload path for `ai_edit` — it
always reads the same stored original, at its full original resolution (the
browser must not send a downscaled preview).

## Prompt architecture

- `productImageTypes.ts` — the `ProductImageType` taxonomy and
  `detectImageType()`.
- `productImagePrompts.ts` — `MASTER_PROMPT` (shared preservation +
  transformation rules, including the 1024x1024 studio-composition
  instructions GPT now owns) + one short SCREEN RULE addition per image type
  + `PRODUCT_IMAGE_PROMPT_VERSION`.
- `productImageEditor.ts` — the one function (`editProductImage`) that ties
  detection + prompt + the OpenAI call together, and returns gpt-image-2's
  buffer as the result. Nothing else should call `openaiClient.editImage`
  directly for product photos.
- `../openaiClient.ts` — generic OpenAI plumbing (client singleton,
  `testConnection`, `classifyOpenAIError`, the raw `editImage` call) with no
  product-specific knowledge, reusable if another feature ever needs OpenAI.

### Adding a new image type

1. Add the value to `ProductImageType` in `productImageTypes.ts`.
2. Map any relevant `ProductViewType`(s) to it in `VIEW_TYPE_TO_BASE`.
3. Add its short addition to `IMAGE_TYPE_ADDITIONS` in `productImagePrompts.ts`.
