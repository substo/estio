import { ghlFetch } from './client';

export interface GHLMediaFile {
    id: string;
    name: string;
    type: 'file' | 'folder';
    mimeType: string;
    size: number;
    url: string;
    folderId: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface UploadMediaOptions {
    hosted?: boolean;
    file?: Blob | File; // For direct upload
    fileUrl?: string;   // For hosted upload
    name?: string;
    folderId?: string;
}

/**
 * Uploads a file to GHL Media Storage
 */
export async function uploadMediaFile(
    accessToken: string,
    options: UploadMediaOptions
): Promise<GHLMediaFile> {
    const formData = new FormData();

    if (options.hosted) {
        formData.append('hosted', 'true');
        if (!options.fileUrl) throw new Error('fileUrl is required when hosted is true');
        formData.append('fileUrl', options.fileUrl);
    } else {
        formData.append('hosted', 'false');
        if (!options.file) throw new Error('file is required when hosted is false');
        formData.append('file', options.file);
    }

    if (options.name) formData.append('name', options.name);
    if (options.folderId) formData.append('folderId', options.folderId);

    // Note: ghlFetch handles JSON by default, but for FormData we need to let the browser/fetch set the Content-Type boundary
    // So we pass a custom header override to remove Content-Type (setting it to undefined lets fetch handle it)
    return await ghlFetch<GHLMediaFile>('/medias/upload-file', accessToken, {
        method: 'POST',
        body: formData,
        headers: {
            'Content-Type': undefined
        } as any
    });
}

/**
 * Lists files in GHL Media Storage
 */
export async function listMediaFiles(
    accessToken: string,
    options: { folderId?: string; page?: number; limit?: number } = {}
): Promise<{ data: GHLMediaFile[]; meta: any }> {
    const params = new URLSearchParams();
    if (options.folderId) params.append('folderId', options.folderId);
    if (options.page) params.append('page', options.page.toString());
    if (options.limit) params.append('limit', options.limit.toString());

    return await ghlFetch<{ data: GHLMediaFile[]; meta: any }>(
        `/medias/files?${params.toString()}`,
        accessToken
    );
}

/**
 * Deletes a file from GHL Media Storage
 */
export async function deleteMediaObject(
    accessToken: string,
    id: string
): Promise<{ success: boolean }> {
    return await ghlFetch<{ success: boolean }>(`/medias/${id}`, accessToken, {
        method: 'DELETE'
    });
}
