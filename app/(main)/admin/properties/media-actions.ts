'use server';

import { uploadToCloudflare, getImageDeliveryUrl } from '@/lib/cloudflareImages';

export async function uploadFile(formData: FormData) {
    const file = formData.get('file') as File;
    // locationId might still be passed but we might not strictly need it for Cloudflare global storage
    // unless we want to tag metadata. For now, we ignore it or validte it exists.
    const locationId = formData.get('locationId') as string;

    if (!file) {
        throw new Error('No file provided');
    }

    // We keep the locationId check to ensure auth/context consistency if needed by caller
    if (!locationId) {
        throw new Error('Location ID is required');
    }

    try {
        const { imageId } = await uploadToCloudflare(file);
        const url = getImageDeliveryUrl(imageId, 'public');

        return {
            url,
            id: imageId // Return ID in case we need it later
        };
    } catch (error) {
        console.error('Upload failed:', error);
        throw new Error('Failed to upload file to Cloudflare');
    }
}
