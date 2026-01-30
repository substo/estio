"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloudflareImageUploader } from "@/components/media/CloudflareImageUploader";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { Loader2, Image as ImageIcon, RefreshCw, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaGalleryDialogProps {
    onSelect: (url: string) => void;
    trigger?: React.ReactNode;
    siteConfig?: any;
}

export function MediaGalleryDialog({ onSelect, trigger, siteConfig }: MediaGalleryDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [images, setImages] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const fetchImages = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/images/list?per_page=50");
            if (!res.ok) throw new Error("Failed to load images");
            const data = await res.json();
            setImages(data.images || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchImages();
        }
    }, [isOpen]);

    const handleSelect = () => {
        if (selectedId) {
            // Retrieve full image object or just construct URL
            // The list API returns variant URLs usually e.g. variants: [ "https://..." ]
            // We can also use our helper if we prefer a standard variant
            const img = images.find(i => i.id === selectedId);
            // Prefer the "public" variant if available, or just the first one, or construct it
            let url = "";
            if (img && img.variants && img.variants.length > 0) {
                // Try to find one named 'public' or just take the first
                url = img.variants[0];
                // If we have a helper that constructs it deterministically:
                // url = getImageDeliveryUrl(selectedId, 'public');
            } else {
                // Fallback
                // We can't import server-side helper here if it uses process.env sensitive bits that aren't public
                // But Cloudflare public hash IS public env var usually.
                // For now, let's rely on what the API returns or the passed ID.
                // The listImages API returns variants.
            }

            // Correction: `getImageDeliveryUrl` is in `lib/cloudflareImages`. 
            // It uses `NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH`. 
            // So we can assume `img.variants` has what we need or just use the ID.

            // Let's use the ID and let the parent decide, OR return the URL. The prop says `onSelect(url)`.
            // We will filter for 'public' variant if possible.
            const publicVariant = img?.variants?.find((v: string) => v.endsWith("/public"));
            const finalUrl = publicVariant || img?.variants?.[0] || "";

            onSelect(finalUrl);
            setIsOpen(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                {trigger || <Button variant="outline"><ImageIcon className="w-4 h-4 mr-2" /> Gallery</Button>}
            </DialogTrigger>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 border-b">
                    <DialogTitle className="flex items-center justify-between">
                        <span>Media Gallery</span>
                        <div className="flex gap-2">
                            {/* Integrated Uploader */}
                            {siteConfig?.locationId && (
                                <CloudflareImageUploader
                                    locationId={siteConfig.locationId}
                                    onUploaded={(newId) => {
                                        fetchImages(); // Refresh list
                                        // Also auto-select?
                                    }}
                                    buttonLabel="Upload New"
                                />
                            )}
                            <Button variant="ghost" size="icon" onClick={fetchImages} disabled={loading}>
                                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                            </Button>
                        </div>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
                    {images.length === 0 && !loading && (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
                            <p>No images found.</p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {images.map((img) => {
                            // Find a suitable thumbnail variant - typically 'public' or something smaller if defined
                            const src = img.variants?.[0] || "";
                            const isSelected = selectedId === img.id;

                            return (
                                <div
                                    key={img.id}
                                    className={cn(
                                        "group relative aspect-square bg-slate-200 rounded-lg overflow-hidden cursor-pointer border-2 transition-all",
                                        isSelected ? "border-primary ring-2 ring-primary ring-offset-2" : "border-transparent hover:border-slate-300"
                                    )}
                                    onClick={() => setSelectedId(img.id)}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={src} alt={img.filename || "Image"} className="w-full h-full object-cover" />

                                    {isSelected && (
                                        <div className="absolute top-2 right-2 bg-primary text-white rounded-full p-1 shadow-sm">
                                            <CheckCircle className="w-4 h-4" />
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] p-1 truncate px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {img.filename}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="p-4 border-t flex justify-end gap-2 bg-white">
                    <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
                    <Button onClick={handleSelect} disabled={!selectedId}>Use Selected Image</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
