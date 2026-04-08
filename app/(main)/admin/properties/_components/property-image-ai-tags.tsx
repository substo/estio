"use client";

interface PropertyImageAiTagsProps {
    isAiGenerated: boolean;
    hasOriginalAvailable: boolean;
    className?: string;
}

export function PropertyImageAiTags({
    isAiGenerated,
    hasOriginalAvailable,
    className = "",
}: PropertyImageAiTagsProps) {
    if (!isAiGenerated && !hasOriginalAvailable) {
        return null;
    }

    return (
        <div className={`flex flex-col gap-1 ${className}`.trim()}>
            {isAiGenerated ? (
                <span className="rounded-full bg-blue-600/90 px-2 py-1 text-[10px] font-medium text-white">
                    AI Generated
                </span>
            ) : null}
            {hasOriginalAvailable ? (
                <span className="rounded-full bg-black/70 px-2 py-1 text-[10px] font-medium text-white">
                    Original Available
                </span>
            ) : null}
        </div>
    );
}
