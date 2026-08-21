import ImageKit from "imagekit";
import dotenv from "dotenv";
import path from "path";
dotenv.config();
export const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!
});
export const uploadToImageKit = async (
    file: Express.Multer.File,
    folder: string
) => {
    const ext = path.extname(file.originalname);

    const filename =
        "gallery-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;

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
export const uploadUrlToImageKit = async (url: string, folder: string) => {
    const filename = "sync-" + Date.now() + "-" + Math.round(Math.random() * 1e9);

    const uploaded = await imagekit.upload({
        file: url,
        fileName: filename,
        folder,
    });

    return uploaded;
};

// For a buffer we already have in memory (e.g. the output of the PhotoRoom
// background-removal + compositing pipeline in imageProcessing.ts).
export const uploadBufferToImageKit = async (buffer: Buffer, folder: string) => {
    const filename = "processed-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ".webp";

    const uploaded = await imagekit.upload({
        file: buffer,
        fileName: filename,
        folder,
    });

    return uploaded;
};

export default imagekit;