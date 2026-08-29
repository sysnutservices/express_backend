import ImageKit from "imagekit";
import dotenv from "dotenv";
import path from "path";
import slugify from "slugify";
dotenv.config();
export const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!
});

// SEO-friendly file names: "dell-latitude-5400-i5-8gb.jpg" beats
// "gallery-1700000000-123456789.jpg" for image search / alt-text-less pages.
// ImageKit's default useUniqueFileName:true still appends its own suffix
// server-side, so collisions are handled without us adding random bytes here.
function seoFilename(hint: string | undefined, fallback: string, ext = ""): string {
    const slug = hint ? slugify(hint, { lower: true, strict: true }) : "";
    return (slug || fallback).slice(0, 100) + ext;
}

export const uploadToImageKit = async (
    file: Express.Multer.File,
    folder: string,
    nameHint?: string
) => {
    const ext = path.extname(file.originalname);
    const filename = seoFilename(nameHint, "product-image", ext);

    const uploaded = await imagekit.upload({
        file: file.buffer,        // buffer (memoryStorage)
        fileName: filename,
        folder,
    });

    return uploaded; // ✅ RETURN FULL OBJECT
};

// Same as uploadToImageKit but for an already-hosted remote image (e.g. from
// the CRM's product sync) — ImageKit's own upload API accepts a URL directly
// as `file` and fetches the bytes server-side, so no separate download step
// is needed here.
export const uploadUrlToImageKit = async (url: string, folder: string, nameHint?: string) => {
    const filename = seoFilename(nameHint, "product-image");

    const uploaded = await imagekit.upload({
        file: url,
        fileName: filename,
        folder,
    });

    return uploaded;
};

// For a buffer we already have in memory (e.g. the output of the PhotoRoom
// background-removal + compositing pipeline in imageProcessing.ts).
export const uploadBufferToImageKit = async (buffer: Buffer, folder: string, nameHint?: string) => {
    const filename = seoFilename(nameHint, "product-image", ".webp");

    const uploaded = await imagekit.upload({
        file: buffer,
        fileName: filename,
        folder,
    });

    return uploaded;
};

export default imagekit;