"use client";

import { ExternalLink, ImageIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { MessageBubbleTheme } from "./message-bubble-theme";
import {
    fetchPropertyUrlContext,
    type PropertyUrlContextResponse,
} from "./property-message-url-client";
import { getPreviewHost } from "./message-link-preview-actions";

type MessageLinkPreviewCardProps = {
    url: string;
    overflowCount?: number;
    theme: MessageBubbleTheme;
};

type PreviewState =
    | { status: "idle" | "loading" }
    | { status: "ready"; preview: PropertyUrlContextResponse }
    | { status: "failed" };

export function MessageLinkPreviewCard({ url, overflowCount = 0, theme }: MessageLinkPreviewCardProps) {
    const [state, setState] = useState<PreviewState>({ status: "idle" });
    const fallbackHost = useMemo(() => getPreviewHost(url), [url]);

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        fetchPropertyUrlContext(url)
            .then((preview) => {
                if (cancelled) return;
                if (!preview.success || (!preview.title && !preview.description && !preview.imageUrl)) {
                    setState({ status: "failed" });
                    return;
                }
                setState({ status: "ready", preview });
            })
            .catch(() => {
                if (!cancelled) setState({ status: "failed" });
            });

        return () => {
            cancelled = true;
        };
    }, [url]);

    if (state.status === "failed") return null;

    const preview = state.status === "ready" ? state.preview : null;
    const title = String(preview?.title || fallbackHost || "Link").trim();
    const description = String(preview?.description || "").trim();
    const imageUrl = String(preview?.imageUrl || "").trim();
    const siteLabel = String(preview?.siteName || fallbackHost || "").trim();

    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={cn(
                "mt-2 block overflow-hidden rounded-md border text-left no-underline transition hover:brightness-[0.98]",
                theme.attachmentCardClassName
            )}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex min-h-[76px] w-full">
                <div className="relative h-auto w-24 shrink-0 bg-slate-100 sm:w-28">
                    {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imageUrl}
                            alt=""
                            className="h-full min-h-[76px] w-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <div className="flex h-full min-h-[76px] w-full items-center justify-center text-slate-400">
                            <ImageIcon className="h-5 w-5" />
                        </div>
                    )}
                </div>
                <div className="min-w-0 flex-1 px-2.5 py-2">
                    <div className={cn("line-clamp-2 text-xs font-semibold leading-snug", theme.attachmentPrimaryTextClassName)}>
                        {state.status === "loading" ? "Loading preview..." : title}
                    </div>
                    {description && (
                        <div className={cn("mt-1 line-clamp-2 text-[11px] leading-snug", theme.attachmentMutedTextClassName)}>
                            {description}
                        </div>
                    )}
                    <div className={cn("mt-1.5 flex min-w-0 items-center gap-1 text-[10px]", theme.attachmentMutedTextClassName)}>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{siteLabel || url}</span>
                        {overflowCount > 0 && <span className="shrink-0">+{overflowCount}</span>}
                    </div>
                </div>
            </div>
        </a>
    );
}
