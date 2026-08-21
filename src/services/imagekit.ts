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

export default imagekit;