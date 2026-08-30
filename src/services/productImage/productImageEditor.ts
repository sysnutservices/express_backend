import { ProductViewType } from "../imageProcessing";
import { editImage, OpenAIEditResult } from "../openaiClient";
import { detectImageType, ProductImageType } from "./productImageTypes";
import { buildProductImagePrompt } from "./productImagePrompts";

// v2.0 architecture: gpt-image-2 owns the ENTIRE transformation — background
// removal, studio composition, lighting/glare/cleanup, and the final
// 1024x1024 canvas — in one call, on the original photo, at full resolution.
// No local segmentation, no OpenAI edit mask, no Sharp recompose of the
// result. See the v2.0 comment at the top of productImagePrompts.ts for why
// (in short: the mask this pipeline had in v1.2 blocked the beautification
// it exists to do, and didn't even reliably hold on gpt-image-2 anyway).
// catalogue_safe is unaffected — this file has never been in its path.
export const AI_EDIT_SIZE = "1024x1024";

export interface ProductImageEditResult extends OpenAIEditResult {
  imageType: ProductImageType;
}

// The one entry point for ai_edit mode's OpenAI call — detects the image
// type, builds the matching prompt, and returns gpt-image-2's own output
// buffer AS the final product image. Nothing else should call
// openaiClient.editImage directly for product photos.
export async function editProductImage(
  originalBuffer: Buffer,
  mimeType: string,
  viewType: ProductViewType
): Promise<ProductImageEditResult> {
  const imageType = await detectImageType(viewType, originalBuffer);
  const prompt = buildProductImagePrompt(imageType);
  const result = await editImage(originalBuffer, mimeType, prompt, AI_EDIT_SIZE);
  return { ...result, imageType };
}
