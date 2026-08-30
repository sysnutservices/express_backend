"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.editProductImage = editProductImage;
const openaiClient_1 = require("../openaiClient");
const productImageTypes_1 = require("./productImageTypes");
const productImagePrompts_1 = require("./productImagePrompts");
// Fixed 1:1 square — unlike catalogue_safe (where computeEditSize matches
// the source's own aspect ratio because Sharp alone decides composition),
// this new ai_edit prompt explicitly asks OpenAI to center/align/compose
// the product itself, so it's given the same square canvas the final
// catalogue image will actually use.
const EDIT_SIZE = "1024x1024";
// The one entry point for ai_edit mode's OpenAI call — detects the image
// type, builds the matching prompt, and runs the edit. Nothing else in the
// codebase should call openaiClient.editImage directly for product photos.
function editProductImage(originalBuffer, mimeType, viewType) {
    return __awaiter(this, void 0, void 0, function* () {
        const imageType = yield (0, productImageTypes_1.detectImageType)(viewType, originalBuffer);
        const prompt = (0, productImagePrompts_1.buildProductImagePrompt)(imageType);
        const result = yield (0, openaiClient_1.editImage)(originalBuffer, mimeType, prompt, EDIT_SIZE);
        return Object.assign(Object.assign({}, result), { imageType });
    });
}
