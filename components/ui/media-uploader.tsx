"use client";

import { useState, useCallback } from "react";
import { UploadCloud, X, File as FileIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile } from "@/app/(main)/admin/properties/media-actions";

interface MediaUploaderProps {
    locationId: string;
    onUploadComplete: (url: string) => void;
    acceptedTypes?: string; // e.g., "image/*", "video/*", "application/pdf"
    maxSizeMB?: number;
    label?: string;
}

export function MediaUploader({
    locationId,
    onUploadComplete,
    acceptedTypes = "image/*",
    maxSizeMB = 25,
    label = "Drop your images here"
}: MediaUploaderProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const processFile = async (file: File) => {
        setError(null);

        // Validate size (pre-resize check, though we resize to fix this)
        if (file.size > maxSizeMB * 1024 * 1024) {
            setError(`File size exceeds ${maxSizeMB}MB limit.`);
            return;
        }

        setIsUploading(true);
        try {
            let fileToUpload = file;

            // Client-side Resize for Images
            if (file.type.startsWith("image/")) {
                try {
                    fileToUpload = await resizeImage(file);
                } catch (resizeError) {
                    console.warn("Resize failed, falling back to original file", resizeError);
                    // Continue with original file
                }
            }

            const formData = new FormData();
            formData.append("file", fileToUpload);
            formData.append("locationId", locationId);

            const result = await uploadFile(formData);
            onUploadComplete(result.url);
        } catch (err) {
            console.error("Upload error:", err);
            setError("Failed to upload file. Please try again.");
        } finally {
            setIsUploading(false);
        }
    };

    // Utility to resize image
    async function resizeImage(file: File): Promise<File> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    const MAX_WIDTH = 1920;
                    const MAX_HEIGHT = 1920;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        reject(new Error("Failed to get canvas context"));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);

                    // Compress to JPEG at 0.8 quality
                    canvas.toBlob((blob) => {
                        if (blob) {
                            const resizedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                                type: "image/jpeg",
                                lastModified: Date.now(),
                            });
                            resolve(resizedFile);
                        } else {
                            reject(new Error("Canvas to Blob failed"));
                        }
                    }, "image/jpeg", 0.8);
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    }

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            processFile(files[0]);
        }
    }, []);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            processFile(files[0]);
        }
    };

    return (
        <div className="w-full">
            <div
                className={cn(
                    "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer relative",
                    isDragging ? "border-primary bg-primary/5" : "border-gray-300 hover:border-primary/50",
                    isUploading ? "opacity-50 pointer-events-none" : ""
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => document.getElementById(`file-upload-${label}`)?.click()}
            >
                <input
                    type="file"
                    id={`file-upload-${label}`}
                    className="hidden"
                    accept={acceptedTypes}
                    onChange={handleFileSelect}
                    disabled={isUploading}
                />

                <div className="flex flex-col items-center justify-center gap-2">
                    {isUploading ? (
                        <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    ) : (
                        <UploadCloud className="h-10 w-10 text-gray-400" />
                    )}

                    <div className="text-lg font-medium text-gray-700">
                        {isUploading ? "Uploading..." : label}
                    </div>

                    {!isUploading && (
                        <div className="text-sm text-gray-500">
                            or <span className="text-primary hover:underline">click here</span> to select
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="mt-2 text-sm text-red-500">
                    {error}
                </div>
            )}
        </div>
    );
}
