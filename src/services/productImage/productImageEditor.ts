import { ProductViewType } from "../imageProcessing";
import { editImage, OpenAIEditResult } from "../openaiClient";
import { detectImageType, ProductImageType } from "./productImageTypes";
import { buildProductImagePrompt } from "./productImagePrompts";

// Fixed 1:1 square — unlike catalogue_safe (where computeEditSize matches
// the source's own aspect ratio because Sharp alone decides composition),
// this new ai_edit prompt explicitly asks OpenAI to center/align/compose
// the product itself, so it's given the same square canvas the final
// catalogue image will actually use.
const EDIT_SIZE = "1024x1024";

export interface ProductImageEditResult extends OpenAIEditResult {
  imageType: ProductImageType;
}

// The one entry point for ai_edit mode's OpenAI call — detects the image
// type, builds the matching prompt, and runs the edit. Nothing else in the
// codebase should call openaiClient.editImage directly for product photos.
export async function editProductImage(
  originalBuffer: Buffer,
  mimeType: string,
  viewType: ProductViewType
): Promise<ProductImageEditResult> {
  const imageType = await detectImageType(viewType, originalBuffer);
  const prompt = buildProductImagePrompt(imageType);
  const result = await editImage(originalBuffer, mimeType, prompt, EDIT_SIZE);
  return { ...result, imageType };
}
