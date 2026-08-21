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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markdownToHtml = void 0;
const remark_1 = require("remark");
const remark_html_1 = __importDefault(require("remark-html"));
const rehype_sanitize_1 = __importDefault(require("rehype-sanitize"));
const markdownToHtml = (markdown) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield (0, remark_1.remark)()
        .use(remark_html_1.default)
        .use(rehype_sanitize_1.default)
        .process(markdown);
    return result.toString();
});
exports.markdownToHtml = markdownToHtml;
