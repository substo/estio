"use client";

import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toggleFavorite } from "@/app/actions/public-user";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
    propertyId: string;
    initialFavorited?: boolean;
    className?: string;
    size?: "sm" | "md" | "lg";
    variant?: "icon" | "button";
}

export function FavoriteButton({
    propertyId,
    initialFavorited = false,
    className,
    size = "md",
    variant = "icon"
}: FavoriteButtonProps) {
    const { isSignedIn } = useAuth();
    const router = useRouter();
    const [isFavorited, setIsFavorited] = useState(initialFavorited);
    const [isPending, startTransition] = useTransition();

    const sizeClasses = {
        sm: "h-8 w-8",
        md: "h-10 w-10",
        lg: "h-12 w-12"
    };

    const iconSizes = {
        sm: 16,
        md: 20,
        lg: 24
    };

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isSignedIn) {
            // Redirect to sign-in with return URL
            router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`);
            return;
        }

        startTransition(async () => {
            const result = await toggleFavorite(propertyId);
            if (result.success) {
                setIsFavorited(result.isFavorited);
            }
        });
    };

    if (variant === "button") {
        return (
            <button
                onClick={handleClick}
                disabled={isPending}
                className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200",
                    isFavorited
                        ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                        : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50",
                    isPending && "opacity-50 cursor-not-allowed",
                    className
                )}
            >
                <Heart
                    className={cn(
                        "transition-all duration-200",
                        isFavorited ? "fill-red-500 text-red-500" : "text-gray-400"
                    )}
                    size={iconSizes[size]}
                />
                <span className="text-sm font-medium">
                    {isFavorited ? "Saved" : "Save"}
                </span>
            </button>
        );
    }

    return (
        <button
            onClick={handleClick}
            disabled={isPending}
            className={cn(
                "flex items-center justify-center rounded-full transition-all duration-200",
                "bg-white/90 backdrop-blur-sm shadow-lg hover:shadow-xl",
                "hover:scale-110 active:scale-95",
                sizeClasses[size],
                isPending && "opacity-50 cursor-not-allowed",
                className
            )}
            title={isFavorited ? "Remove from favorites" : "Add to favorites"}
        >
            <Heart
                className={cn(
                    "transition-all duration-200",
                    isFavorited
                        ? "fill-red-500 text-red-500"
                        : "text-gray-400 hover:text-red-400"
                )}
                size={iconSizes[size]}
            />
        </button>
    );
}
