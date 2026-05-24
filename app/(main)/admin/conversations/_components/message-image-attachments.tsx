"use client";

import { useState } from "react";
import { Download, ExternalLink, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { NormalizedMessageAttachment } from "./message-bubble-attachment-actions";

type MessageImageAttachmentsProps = {
    imageAttachments: NormalizedMessageAttachment[];
    getDownloadUrl: (url: string) => string;
};

export function MessageImageAttachments({
    imageAttachments,
    getDownloadUrl,
}: MessageImageAttachmentsProps) {
    const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
    const selectedImage = selectedImageIndex !== null ? imageAttachments[selectedImageIndex] : null;

    return (
        <>
            {imageAttachments.map((attachment, i) => (
                <button
                    key={`img-${i}-${attachment.url}`}
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImageIndex(i);
                    }}
                    aria-label={`Open image attachment ${i + 1}`}
                    className="block rounded-lg overflow-hidden border border-black/10 bg-black/5 hover:opacity-95 transition-opacity"
                >
                    <div className="relative">
                        <img
                            src={attachment.url}
                            alt={attachment.fileName || `Image attachment ${i + 1}`}
                            loading="lazy"
                            className="block max-h-80 w-auto max-w-full object-contain bg-white"
                        />
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white shadow">
                            <Maximize2 className="h-3 w-3" />
                            View
                        </span>
                    </div>
                </button>
            ))}

            <Dialog open={selectedImageIndex !== null} onOpenChange={(open) => { if (!open) setSelectedImageIndex(null); }}>
                <DialogContent className="max-w-[96vw] w-[min(96vw,1100px)] p-0 gap-0 overflow-hidden border-zinc-800 bg-zinc-950 text-white">
                    <DialogTitle className="sr-only">
                        {selectedImage?.fileName || "Image attachment preview"}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Preview and download image attachment.
                    </DialogDescription>

                    <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3 pr-14">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {selectedImage?.fileName || "Image attachment"}
                            </p>
                            <p className="text-xs text-zinc-400">
                                Press Esc to close
                            </p>
                        </div>
                        {selectedImage && (
                            <div className="flex items-center gap-2">
                                <a
                                    href={getDownloadUrl(selectedImage.url)}
                                    download={selectedImage.fileName || "attachment"}
                                    className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                </a>
                                <a
                                    href={selectedImage.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open
                                </a>
                            </div>
                        )}
                    </div>

                    <div className="flex max-h-[80vh] items-center justify-center bg-black p-3 sm:p-4">
                        {selectedImage && (
                            <img
                                src={selectedImage.url}
                                alt={selectedImage.fileName || "Image attachment preview"}
                                className="max-h-[calc(80vh-2rem)] max-w-full object-contain"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
