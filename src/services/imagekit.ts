import ImageKit from "imagekit";
import dotenv from "dotenv";
import slugify from "slugify";
import sharp from "sharp";
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

// Isolated so the actual format-conversion logic (get this wrong and every
// uploaded image silently keeps its original format) can be exercised by
// imagekit.selftest.ts without touching the network/API key the upload
// functions themselves need. gif is included in this conversion; an
// animated one loses its animation (sharp keeps only the first frame unless
// told otherwise), but product/site photos are never actually animated in
// practice.
export async function toWebpBuffer(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer).webp({ quality: 90 }).toBuffer();
}

// Every direct-upload path (product image fallback, gallery/site-content
// uploads) funnels through this one function, so converting to WebP here —
// once — covers all of them instead of needing the same sharp call at every
// call site.
export const uploadToImageKit = async (
    file: Express.Multer.File,
    folder: string,
    nameHint?: string
) => {
    const webpBuffer = await toWebpBuffer(file.buffer);
    const filename = seoFilename(nameHint, "product-image", ".webp");

    const uploaded = await imagekit.upload({
        file: webpBuffer,
        fileName: filename,
        folder,
    });

    return uploaded; // ✅ RETURN FULL OBJECT
};

// Same as uploadToImageKit but for an already-hosted remote image (e.g. from
// the CRM's product sync). Fetches the bytes ourselves (rather than handing
// ImageKit the URL to fetch server-side, the old approach) so they can be
// converted to WebP first — otherwise a CRM-synced image would keep whatever
// format the source URL served.
export const uploadUrlToImageKit = async (url: string, folder: string, nameHint?: string) => {
    const filename = seoFilename(nameHint, "product-image", ".webp");

    const fetched = await fetch(url);
    if (!fetched.ok) throw new Error(`Could not fetch source image for upload (${fetched.status})`);
    const buffer = Buffer.from(await fetched.arrayBuffer());
    const webpBuffer = await toWebpBuffer(buffer);

    const uploaded = await imagekit.upload({
        file: webpBuffer,
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