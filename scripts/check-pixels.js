const sharp = require('sharp');
const fs = require('fs');

const images = [
    '/Users/martingreen/.gemini/antigravity/brain/a57fd5ac-a5a3-4b17-aaab-bc3c8da24075/uploaded_image_0_1766860033283.png',
    '/Users/martingreen/.gemini/antigravity/brain/a57fd5ac-a5a3-4b17-aaab-bc3c8da24075/uploaded_image_1_1766860033283.png'
];

async function checkPixel(path) {
    // Check the color of the top-left pixel
    const { data, info } = await sharp(path)
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Assuming 4 channels (RGBA)
    const pixel = [data[0], data[1], data[2], data[3]];
    console.log(`\nFile: ${path}`);
    console.log(`Top-Left Pixel (RGBA): ${pixel.join(',')}`);

    // Check center pixel roughly
    const centerIdx = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
    const centerPixel = [data[centerIdx], data[centerIdx + 1], data[centerIdx + 2], data[centerIdx + 3]];
    console.log(`Center Pixel (RGBA): ${centerPixel.join(',')}`);
}

(async () => {
    for (const img of images) {
        await checkPixel(img);
    }
})();
