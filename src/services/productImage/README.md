# AI product-image editing (`ai_edit` mode)

This directory is the new prompt/editing system for `ai_edit` mode — the
explicit, opt-in alternative to the default `catalogue_safe` pipeline (real
local segmentation, no OpenAI, never touches product pixels — see the
comment at the top of `../productImageOrchestrator.ts`). `ai_edit` is for
photos `catalogue_safe` can't clean up well enough on its own (messy
backgrounds, real reflections, uneven lighting) — it costs money, can alter
product pixels, and always lands in `READY_FOR_REVIEW` for manual approval,
never auto-published.

## Configuring `OPENAI_API_KEY`

Server-side only, in the backend's `.env`:

```
OPENAI_API_KEY=sk-...
```

Never `NEXT_PUBLIC_OPENAI_API_KEY` — the frontend never sees this value.
Admins can also set/rotate it from **Admin → Settings → AI Settings**, which
writes to the same `.env` file server-side (`aiSettingsController.ts` +
`utils/envFile.ts`) and never echoes the key back to the browser.

## How an `ai_edit` request works

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
     `model: "gpt-image-2"`, the real photo as the image input, a fixed
     1024×1024 (1:1) size, and that prompt. One call per attempt, with up to
     2 retries only for transient errors (429/5xx/timeout — never for
     invalid input or content-policy rejections).
4. The orchestrator re-runs the *same* local segmentation (IS-Net) on
   OpenAI's output — OpenAI's own transparency, if any, is never trusted —
   to get a robust alpha/bounding box, then Sharp composites the transparent
   master, the white ecommerce derivative, and the 2000/1200/500 catalogue
   sizes exactly as `catalogue_safe` does. OpenAI is never called again for
   any of those derivative sizes.
5. A local reflection check (`imageProcessing.analyzeReflection`) flags any
   residual glare in `qualityWarning` — informational only, never blocks
   approval.

## Supported image formats & validation

`upload-original` (the only place a file is actually uploaded) accepts
`image/*` MIME types via `multer`'s file filter in `productController.ts`'s
`upload` config; HEIC gets converted client-side first
(`lib/convertHeic.ts`). There's no separate upload path for `ai_edit` — it
always reads the same stored original.

## Prompt architecture

- `productImageTypes.ts` — the `ProductImageType` taxonomy and
  `detectImageType()`.
- `productImagePrompts.ts` — `MASTER_PROMPT` (shared, non-negotiable
  preservation rules) + one short addition per image type +
  `PRODUCT_IMAGE_PROMPT_VERSION`.
- `productImageEditor.ts` — the one function (`editProductImage`) that ties
  detection + prompt + the OpenAI call together. Nothing else should call
  `openaiClient.editImage` directly for product photos.
- `../openaiClient.ts` — generic OpenAI plumbing (client singleton,
  `testConnection`, `classifyOpenAIError`, the raw `editImage` call) with no
  product-specific knowledge, reusable if another feature ever needs OpenAI.

### Adding a new image type

1. Add the value to `ProductImageType` in `productImageTypes.ts`.
2. Map any relevant `ProductViewType`(s) to it in `VIEW_TYPE_TO_BASE`.
3. Add its short addition to `IMAGE_TYPE_ADDITIONS` in `productImagePrompts.
   ts` — narrow and specific, never contradicting `MASTER_PROMPT`.
4. Bump `PRODUCT_IMAGE_PROMPT_VERSION` (see below) and add a
   `productImagePrompts.selftest.ts` assertion for it.

### Updating prompt versions

Bump `PRODUCT_IMAGE_PROMPT_VERSION` (`"v1.0"` → `"v1.1"` → `"v2.0"`, your
call) whenever `MASTER_PROMPT` or any per-type addition changes. It feeds
`imageCostControl.computeProcessingHash`, so a version bump makes old
generations ineligible for fingerprint reuse — a fresh viewType+mode
combination always re-runs against the new prompt instead of silently
reusing a result the new wording would have produced differently.

## Storage & version history

Reuses the project's existing ImageKit + `ProductImage` Mongoose model —
nothing new was introduced here. Every attempt (success or failure) is one
`ProductImage` document (`rootImageId` set, `version` incremented):
`originalImageUrl`/`originalImageHash` (denormalized from the root, never
reassigned — the original is never overwritten), `cutoutImageUrl`,
`transparentMasterUrl`, `masterImageUrl`/`productImageUrl`/
`thumbnailImageUrl`, `processingModel`, `processingSettings`,
`processingHash`, `promptVersion`, `processingConfigVersion`, `status`,
`qualityWarning`, `rejectionReason`. `ImageProcessingUsage` (`services/
imageCostControl.ts`) logs one row per OpenAI attempt: model, status,
duration, estimated cost — never the image bytes themselves.

## Error handling

`OrchestratorError` carries a typed `code` (`AI_DISABLED`, `MONTHLY_BUDGET`,
`DAILY_LIMIT`, `HOURLY_LIMIT`, `OPENAI_FAILED`, ...) that
`productImageController.mapOrchestratorError` turns into the right HTTP
status and a clean, generic message — no stack traces or provider error
text reach the client. Budget/rate-limit checks run *before* the OpenAI call
(`imageCostControl.checkBudgetAndLimits`); a failed attempt still gets its
own `ImageProcessingUsage` row (money can be spent on a failed call).

## Duplicate-generation protection

A partial unique Mongo index on `{rootImageId, processingHash, status:
"PROCESSING"}` means a second rapid click for the same
original+viewType+mode+prompt-version hits `E11000` instead of starting a
second OpenAI call — the orchestrator catches that and returns the
already-in-flight document instead. A fingerprint that already produced a
`READY_FOR_REVIEW`/`APPROVED`/`PUBLISHED` result is reused via a Sharp-only
recompute (`recomposeVersion`) instead of calling OpenAI again.
