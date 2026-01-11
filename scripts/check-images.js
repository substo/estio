const sharp = require('sharp');
const fs = require('fs');

const images = [
    '/Users/martingreen/.gemini/antigravity/brain/a57fd5ac-a5a3-4b17-aaab-bc3c8da24075/uploaded_image_0_1766860033283.png',
    '/Users/martingreen/.gemini/antigravity/brain/a57fd5ac-a5a3-4b17-aaab-bc3c8da24075/uploaded_image_1_1766860033283.png'
];

async function checkImage(path) {
    try {
        const metadata = await sharp(path).metadata();
        const stats = await sharp(path).stats();
        console.log(`\nFile: ${path}`);
        console.log(`Format: ${metadata.format}`);
        console.log(`Channels: ${metadata.channels}`);
        console.log(`Has Alpha: ${metadata.hasAlpha}`);
        console.log(`IsOpaque: ${stats.isOpaque}`);
    } catch (e) {
        console.error(`Error checking ${path}:`, e);
    }
}

(async () => {
    for (const img of images) {
        await checkImage(img);
    }
})();
