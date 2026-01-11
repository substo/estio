
export class CloudflareImageError extends Error {
    constructor(message: string, public statusCode?: number) {
        super(message);
        this.name = "CloudflareImageError";
    }
}

interface DirectUploadResponse {
    result: {
        id: string;
        uploadURL: string;
    };
    success: boolean;
    errors: Array<{ code: number; message: string }>;
    messages: Array<any>;
}

interface CreateDirectUploadUrlOptions {
    requireSignedURLs?: boolean;
    metadata?: Record<string, any>;
}

/**
 * Creates a Direct Upload URL for Cloudflare Images.
 * @param options Configuration options for the upload
 * @returns Object containing the uploadURL and the reserved imageId
 */
export async function createDirectUploadUrl(
    options: CreateDirectUploadUrlOptions = {}
): Promise<{ uploadURL: string; imageId: string }> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

    if (!accountId || !token) {
        throw new CloudflareImageError("Missing Cloudflare configuration");
    }

    const formData = new FormData();
    formData.append("requireSignedURLs", String(options.requireSignedURLs || false));

    if (options.metadata) {
        formData.append("metadata", JSON.stringify(options.metadata));
    }

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v2/direct_upload`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            }
        );

        const data: DirectUploadResponse = await response.json();

        if (!data.success) {
            throw new CloudflareImageError(
                data.errors[0]?.message || "Failed to create direct upload URL",
                response.status
            );
        }

        return {
            uploadURL: data.result.uploadURL,
            imageId: data.result.id,
        };
    } catch (error) {
        if (error instanceof CloudflareImageError) {
            throw error;
        }
        throw new CloudflareImageError("Network error communicating with Cloudflare");
    }
}

/**
 * Uploads a file buffer directly to Cloudflare Images from the server.
 * Useful when the file is already on the server (e.g. Server Actions).
 */
export async function uploadToCloudflare(file: File | Blob): Promise<{ uploadURL: string; imageId: string }> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

    if (!accountId || !token) {
        throw new CloudflareImageError("Missing Cloudflare configuration");
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            }
        );

        const data: DirectUploadResponse = await response.json();

        if (!data.success) {
            throw new CloudflareImageError(
                data.errors[0]?.message || "Failed to upload image",
                response.status
            );
        }

        return {
            uploadURL: "",
            imageId: data.result.id,
        };
    } catch (error) {
        if (error instanceof CloudflareImageError) {
            throw error;
        }
        console.error("Cloudflare Upload Error:", error);
        throw new CloudflareImageError("Network error uploading to Cloudflare");
    }
}

/**
 * Uploads an image from a URL directly to Cloudflare Images.
 * @param url The URL of the image to upload
 * @returns Object containing the imageId
 */
export async function uploadUrlToCloudflare(url: string): Promise<{ uploadURL: string; imageId: string }> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

    if (!accountId || !token) {
        throw new CloudflareImageError("Missing Cloudflare configuration");
    }

    try {
        const formData = new FormData();
        formData.append("url", url);

        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            }
        );

        const data: DirectUploadResponse = await response.json();

        if (!data.success) {
            throw new CloudflareImageError(
                data.errors[0]?.message || "Failed to upload image from URL",
                response.status
            );
        }

        return {
            uploadURL: "",
            imageId: data.result.id,
        };
    } catch (error) {
        if (error instanceof CloudflareImageError) {
            throw error;
        }
        console.error("Cloudflare URL Upload Error:", error);
        throw new CloudflareImageError("Network error uploading URL to Cloudflare");
    }
}

/**
 * Generates the public delivery URL for a Cloudflare Image.
 * @param imageId The ID of the image stored in Cloudflare
 * @param variant The named variant to request (default: "public")
 * @returns The full URL to the image
 */
export function getImageDeliveryUrl(imageId: string, variant: string = "public"): string {
    const accountHash = process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH;

    if (!accountHash) {
        console.error("NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH is not set");
        // Fallback or potentially throw, but returning a constructing URL might be safer for rendering
        return "";
    }

    return `https://imagedelivery.net/${accountHash}/${imageId}/${variant}`;
}

/**
 * Deletes an image from Cloudflare.
 * @param imageId The ID of the image to delete
 */
export async function deleteImage(imageId: string): Promise<void> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

    if (!accountId || !token) {
        throw new CloudflareImageError("Missing Cloudflare configuration");
    }

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(imageId)}`,
            {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        const data = await response.json();

        // Cloudflare returns success: true even if image not found sometimes, 
        // but check for errors just in case.
        if (!data.success) {
            throw new CloudflareImageError(
                data.errors[0]?.message || "Failed to delete image",
                response.status
            );
        }
    } catch (error) {
        if (error instanceof CloudflareImageError) {
            throw error;
        }
        throw new CloudflareImageError("Network error deleting image");
    }
}

interface ListImagesOptions {
    page?: number;
    per_page?: number;
}

/**
 * Lists images from Cloudflare.
 */
export async function listImages(options: ListImagesOptions = {}): Promise<{
    images: Array<{
        id: string;
        filename: string;
        uploaded: string;
        variants: string[];
    }>;
    success: boolean;
}> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

    if (!accountId || !token) {
        throw new CloudflareImageError("Missing Cloudflare configuration");
    }

    const params = new URLSearchParams();
    if (options.page) params.append("page", String(options.page));
    if (options.per_page) params.append("per_page", String(options.per_page));

    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1?${params.toString()}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        const data = await response.json();

        if (!data.success) {
            throw new CloudflareImageError(
                data.errors[0]?.message || "Failed to list images",
                response.status
            );
        }

        return {
            images: data.result.images,
            success: true
        };
    } catch (error) {
        if (error instanceof CloudflareImageError) {
            throw error;
        }
        throw new CloudflareImageError("Network error listing images");
    }
}
