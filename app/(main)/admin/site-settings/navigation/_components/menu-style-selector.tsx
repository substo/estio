"use client";

import { useState } from "react";
import { SidebarClose, PanelTopClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveNavigationStyle } from "../actions";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface MenuStyleSelectorProps {
    initialStyle: "side" | "top";
}

export function MenuStyleSelector({ initialStyle }: MenuStyleSelectorProps) {
    const [style, setStyle] = useState<"side" | "top">(initialStyle);
    const [loading, setLoading] = useState(false);

    const handleSelect = async (newStyle: "side" | "top") => {
        if (newStyle === style) return;
        setLoading(true);
        setStyle(newStyle);

        try {
            await saveNavigationStyle(newStyle);
            toast.success("Menu style saved successfully");
        } catch (error) {
            console.error(error);
            toast.error("Failed to save menu style");
            setStyle(style); // Revert on failure
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-lg border shadow-sm">
            <h2 className="text-xl font-bold mb-4">Header Menu Style</h2>
            <p className="text-sm text-muted-foreground mb-6">
                Choose how the mobile and tablet navigation menu appears when opened.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Option 1: Right Side Slide */}
                <div
                    onClick={() => handleSelect("side")}
                    className={cn(
                        "cursor-pointer border-2 rounded-lg p-4 transition-all hover:border-gray-300 relative",
                        style === "side" ? "border-primary bg-primary/5" : "border-gray-100"
                    )}
                >
                    <div className="flex items-center gap-3 mb-3">
                        <div className={cn(
                            "p-2 rounded-md",
                            style === "side" ? "bg-primary text-white" : "bg-gray-100 text-gray-500"
                        )}>
                            <SidebarClose className="h-5 w-5 rotate-180" />
                        </div>
                        <span className="font-semibold">Side Drawer</span>
                    </div>
                    <div className="h-32 bg-gray-50 rounded border border-gray-100 relative overflow-hidden">
                        {/* Mockup */}
                        <div className="absolute top-0 right-0 w-1/2 h-full bg-white border-l shadow-lg transform translate-x-0 transition-transform">
                            <div className="p-3 space-y-2">
                                <div className="h-2 w-3/4 bg-gray-200 rounded"></div>
                                <div className="h-2 w-1/2 bg-gray-200 rounded"></div>
                                <div className="h-2 w-2/3 bg-gray-200 rounded"></div>
                            </div>
                        </div>
                    </div>
                    {style === "side" && (
                        <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary animate-pulse" />
                    )}
                </div>

                {/* Option 2: Top Slide Down */}
                <div
                    onClick={() => handleSelect("top")}
                    className={cn(
                        "cursor-pointer border-2 rounded-lg p-4 transition-all hover:border-gray-300 relative",
                        style === "top" ? "border-primary bg-primary/5" : "border-gray-100"
                    )}
                >
                    <div className="flex items-center gap-3 mb-3">
                        <div className={cn(
                            "p-2 rounded-md",
                            style === "top" ? "bg-primary text-white" : "bg-gray-100 text-gray-500"
                        )}>
                            <PanelTopClose className="h-5 w-5" />
                        </div>
                        <span className="font-semibold">Top Dropdown</span>
                    </div>
                    <div className="h-32 bg-gray-50 rounded border border-gray-100 relative overflow-hidden">
                        {/* Mockup */}
                        <div className="absolute top-0 left-0 w-full h-1/2 bg-white border-b shadow-lg transform translate-y-0 transition-transform flex items-center justify-center">
                            {/* Horizontal items mockup */}
                            <div className="flex items-center gap-3">
                                <div className="h-1.5 w-8 bg-gray-300 rounded-full"></div>
                                <div className="h-1.5 w-8 bg-gray-300 rounded-full"></div>
                                <div className="h-1.5 w-8 bg-gray-300 rounded-full"></div>
                                <div className="h-1.5 w-8 bg-gray-300 rounded-full"></div>
                            </div>
                        </div>
                    </div>
                    {style === "top" && (
                        <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary animate-pulse" />
                    )}
                </div>
            </div>

            {loading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                </div>
            )}
        </div>
    );
}
