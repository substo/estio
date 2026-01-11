"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

interface CloudflareImageUploaderProps {
    onUploaded: (imageId: string) => void;
    buttonLabel?: string;
    className?: string;
    locationId: string; // Passed to ensure we scope the upload URL request properly
    disabled?: boolean;
}

export function CloudflareImageUploader({
    onUploaded,
    buttonLabel = "Upload Image",
    className,
    locationId,
    disabled
}: CloudflareImageUploaderProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0); // Optional: if we want to show count
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsUploading(true);
        setError(null);
        setUploadProgress(0);
        console.log(`Starting upload process for ${files.length} files...`);

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                console.log(`Uploading file ${i + 1}/${files.length}: ${file.name}`);

                try {
                    // 1. Get Direct Upload URL
                    const response = await fetch("/api/images/direct-upload", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            locationId,
                            metadata: { filename: file.name }
                        }),
                    });

                    if (!response.ok) throw new Error("Failed to get upload URL");

                    const { uploadURL, imageId } = await response.json();

                    // 2. Upload file to Cloudflare
                    const formData = new FormData();
                    formData.append("file", file);

                    const uploadResponse = await fetch(uploadURL, {
                        method: "POST",
                        body: formData,
                    });

                    if (!uploadResponse.ok) {
                        const errorText = await uploadResponse.text();
                        throw new Error(`Cloudflare Upload Failed: ${errorText}`);
                    }

                    // 3. Notify parent for EACH success
                    onUploaded(imageId);
                    setUploadProgress(prev => prev + 1);

                } catch (innerErr: any) {
                    console.error(`Error uploading ${file.name}:`, innerErr);
                    toast.error(`Failed to upload ${file.name}: ${innerErr.message}`);
                    // Continue to next file
                }
            }

            console.log("Batch upload flow complete.");

        } catch (err: any) {
            console.error("Upload Error Catch:", err);
            setError(err.message || "Upload failed");
            toast.error(`Upload Failed: ${err.message}`);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            // Reset input
            if (inputRef.current) {
                inputRef.current.value = "";
            }
        }
    };

    return (
        <div className={`relative ${className}`}>
            {error && <p className="text-sm text-red-500 mb-2">{error}</p>}

            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    disabled={isUploading || disabled}
                    onClick={() => inputRef.current?.click()}
                    type="button"
                >
                    {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
                    {isUploading ? `Uploading ${uploadProgress}...` : buttonLabel}
                </Button>
            </div>

            <input
                ref={inputRef}
                type="file"
                accept="image/*" // Restrict to images
                multiple // ALLOW MULTIPLE SELECTION
                className="hidden"
                onChange={handleFileChange}
                disabled={isUploading || disabled}
            />
        </div>
    );
}
