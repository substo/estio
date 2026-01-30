import { uploadMediaFile, listMediaFiles, deleteMediaObject } from '../lib/ghl/media';
import db from '../lib/db';
import { refreshGhlAccessToken } from '../lib/location';
import fs from 'fs';
import path from 'path';

async function main() {
    const locationId = process.argv[2];
    if (!locationId) {
        console.error('Please provide a Location ID (internal or GHL)');
        process.exit(1);
    }

    // 1. Get Location & Token
    let location = await db.location.findFirst({
        where: {
            OR: [
                { id: locationId },
                { ghlLocationId: locationId }
            ]
        }
    });

    if (!location || !location.ghlAccessToken) {
        console.error('Location not found or not connected');
        process.exit(1);
    }

    console.log(`Using Location: ${location.name} (${location.ghlLocationId})`);

    // Refresh token
    try {
        const refreshed = await refreshGhlAccessToken(location);
        if (refreshed.ghlAccessToken) {
            location.ghlAccessToken = refreshed.ghlAccessToken;
            // Update local variable
            location = refreshed;
        }
    } catch (e) {
        console.error('Failed to refresh token:', e);
        process.exit(1);
    }

    if (!location) {
        throw new Error('Location not found');
    }
    const accessToken = location.ghlAccessToken!;

    // 2. Test List
    console.log('\n--- Testing List ---');
    let uploadedId: string | undefined;
    try {
        const list = await listMediaFiles(accessToken, { limit: 5 });
        console.log(`✅ List Successful. Found ${list.data.length} files.`);
    } catch (e: any) {
        console.error('❌ List Failed:', e.message);
        if (e.data) console.error('   Error Data:', JSON.stringify(e.data, null, 2));
    }

    // 3. Test Upload
    console.log('\n--- Testing Upload ---');
    // Create a dummy file
    const testFilePath = path.join(__dirname, 'test-image.txt');
    fs.writeFileSync(testFilePath, 'This is a test file for GHL Media API');
    const fileBuffer = fs.readFileSync(testFilePath);
    const fileBlob = new Blob([fileBuffer], { type: 'text/plain' });

    try {
        const uploaded = await uploadMediaFile(accessToken, {
            file: fileBlob,
            name: 'test-upload-script.txt',
            hosted: false
        });
        console.log('✅ Upload Successful:', uploaded);
        uploadedId = uploaded.id;

        // 4. Test Delete
        console.log('\n--- Testing Delete ---');
        await deleteMediaObject(accessToken, uploadedId);
        console.log('✅ Delete Successful');

    } catch (e: any) {
        console.error('❌ Upload/Delete Failed:', e);
        if (e.data) console.error('   Error Data:', JSON.stringify(e.data, null, 2));
    } finally {
        // Cleanup
        if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
        await db.$disconnect();
    }
}

main();
