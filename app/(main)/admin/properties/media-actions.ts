'use server';

import { uploadToCloudflare, getImageDeliveryUrl } from '@/lib/cloudflareImages';
import { requireAuthenticatedLocationContext } from '@/lib/properties/active-location-access';

export async function uploadFile(formData: FormData) {
    const file = formData.get('file') as File;
    const requestedLocationId = formData.get('locationId');

    if (!file) {
        throw new Error('No file provided');
    }

    const access = await requireAuthenticatedLocationContext(
        typeof requestedLocationId === 'string' ? requestedLocationId : null,
    );

    try {
        const { imageId } = await uploadToCloudflare(file, {
            metadata: {
                locationId: access.locationId,
                uploadedBy: access.dbUserId,
                purpose: "property_media",
                workflow: "property_editor",
            },
        });
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
