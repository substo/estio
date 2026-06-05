"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Images, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deriveAttachmentDownloadUrl } from "./message-bubble-attachment-actions";
import { getMessageBubbleTheme } from "./message-bubble-theme";
import type { MessageImageGroup as MessageImageGroupData } from "./message-image-grouping";

type MessageImageGroupProps = {
    group: MessageImageGroupData;
    contactName?: string;
};

function getImageLabel(group: MessageImageGroupData, index: number) {
    return group.items[index]?.image.fileName || `Image ${index + 1}`;
}

export function MessageImageGroup({ group, contactName }: MessageImageGroupProps) {
    const [groupOpen, setGroupOpen] = useState(false);
    const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
    const isOutbound = group.direction === "outbound";
    const theme = getMessageBubbleTheme({ isWhatsApp: true, isSMS: false, isEmail: false, isOutbound });
    const selectedItem = selectedImageIndex !== null ? group.items[selectedImageIndex] : null;
    const firstFour = group.items.slice(0, 4);
    const overflowCount = Math.max(0, group.items.length - firstFour.length);

    const closeGroup = useCallback((open: boolean) => {
        setGroupOpen(open);
        if (!open) setSelectedImageIndex(null);
    }, []);

    return (
        <div
            className={cn(
                "flex flex-col max-w-[85%] min-w-0 overflow-hidden sm:max-w-[min(88%,34rem)]",
                isOutbound ? "ml-auto items-end" : "mr-auto items-start"
            )}
        >
            <button
                type="button"
                onClick={() => setGroupOpen(true)}
                className={cn(
                    "group relative w-full overflow-hidden rounded-2xl p-2 text-left text-sm shadow-sm transition-all hover:shadow-md",
                    theme.bubbleClassName
                )}
                aria-label={`Open image group with ${group.items.length} images`}
            >
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                        <Images className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{group.items.length} images</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-black/10 px-2 py-1 text-[11px] font-medium">
                        <Maximize2 className="h-3 w-3" />
                        Open
                    </span>
                </div>
                <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-xl bg-black/10">
                    {firstFour.map((item, index) => (
                        <div key={`${item.message.id}-${item.image.url}`} className="relative min-h-0 overflow-hidden bg-white">
                            <img
                                src={item.image.url}
                                alt={item.image.fileName || `Grouped image ${index + 1}`}
                                loading="lazy"
                                className="h-full w-full object-cover"
                            />
                            {overflowCount > 0 && index === firstFour.length - 1 && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-xl font-semibold text-white">
                                    +{overflowCount}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </button>
            <div className={cn("mt-1 px-1 text-[10px]", isOutbound ? "text-right" : "text-left", theme.timestampClassName)}>
                {new Date(group.messages[group.messages.length - 1]?.dateAdded || Date.now()).toLocaleString()}
                {!isOutbound && contactName ? ` • ${contactName}` : ""}
            </div>

            <Dialog open={groupOpen} onOpenChange={closeGroup}>
                <DialogContent className="max-w-[96vw] w-[min(96vw,980px)] max-h-[92vh] p-0 gap-0 overflow-hidden border-zinc-800 bg-zinc-950 text-white">
                    <DialogTitle className="sr-only">
                        {selectedItem ? getImageLabel(group, selectedImageIndex || 0) : `${group.items.length} grouped images`}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Browse grouped WhatsApp images and open an individual image preview.
                    </DialogDescription>

                    <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3 pr-14">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {selectedItem ? getImageLabel(group, selectedImageIndex || 0) : `${group.items.length} images`}
                            </p>
                            <p className="text-xs text-zinc-400">
                                {selectedItem ? "Viewing image" : "Click an image to enlarge"}
                            </p>
                        </div>
                        {selectedItem && (
                            <div className="flex shrink-0 items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setSelectedImageIndex(null)}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                    aria-label="Back to grouped images"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                </button>
                                <a
                                    href={deriveAttachmentDownloadUrl(selectedItem.image.url)}
                                    download={selectedItem.image.fileName || "attachment"}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                    aria-label="Download image"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                </a>
                                <a
                                    href={selectedItem.image.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                    aria-label="Open image in new tab"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            </div>
                        )}
                    </div>

                    {selectedItem ? (
                        <div className="flex max-h-[calc(92vh-4rem)] items-center justify-center overflow-auto bg-black p-3 sm:p-4">
                            <img
                                src={selectedItem.image.url}
                                alt={selectedItem.image.fileName || "Grouped image preview"}
                                className="max-h-[calc(92vh-6rem)] max-w-full object-contain"
                            />
                        </div>
                    ) : (
                        <div className="max-h-[calc(92vh-4rem)] overflow-y-auto bg-zinc-950 p-3 sm:p-4">
                            <div className="space-y-3">
                                {group.items.map((item, index) => (
                                    <button
                                        key={`${item.message.id}-${item.image.url}-list`}
                                        type="button"
                                        onClick={() => setSelectedImageIndex(index)}
                                        className={cn(
                                            "flex w-full gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 p-2 text-left transition-colors hover:bg-zinc-900",
                                            item.message.direction === "outbound" ? "ml-auto" : "mr-auto"
                                        )}
                                    >
                                        <div className="h-28 w-28 shrink-0 overflow-hidden rounded-md bg-black sm:h-36 sm:w-36">
                                            <img
                                                src={item.image.url}
                                                alt={item.image.fileName || `Grouped image ${index + 1}`}
                                                loading="lazy"
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="min-w-0 flex-1 self-center">
                                            <p className="truncate text-sm font-medium text-zinc-100">{getImageLabel(group, index)}</p>
                                            <p className="mt-1 text-xs text-zinc-400">
                                                {new Date(item.message.dateAdded).toLocaleString()}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
