import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import os from 'os';
import axios from 'axios';

export async function downloadAndResetImage(imageUrl: string, index: number): Promise<string | null> {
    try {
        const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer',
        });

        const buffer = Buffer.from(response.data);
        const tempDir = os.tmpdir();
        const filePath = path.join(tempDir, `property-image-${index}-${Date.now()}.jpg`);

        await sharp(buffer)
            .toFormat('jpeg')
            .jpeg({ quality: 80 })
            .toFile(filePath);

        return filePath;
    } catch (error) {
        console.error(`Failed to process image ${imageUrl}:`, error);
        return null;
    }
}

export function cleanupTempImage(filePath: string) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        console.error(`Failed to cleanup temp file ${filePath}:`, error);
    }
}
