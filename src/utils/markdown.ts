import { remark } from "remark";
import remarkHtml from "remark-html";
import rehypeSanitize from "rehype-sanitize";

export const markdownToHtml = async (markdown: string): Promise<string> => {
    const result = await remark()
        .use(remarkHtml)
        .use(rehypeSanitize)
        .process(markdown);

    return result.toString();
};
