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

    const preview = state.status === "ready" ? state.preview : null;
    const title = String(preview?.title || fallbackHost || "Link").trim();
    const description = String(preview?.description || "").trim();
    const imageUrl = String(preview?.imageUrl || "").trim();
    const siteLabel = String(preview?.siteName || fallbackHost || "").trim();
    const isLoading = state.status === "loading" || state.status === "idle";

    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className={cn(
                "mt-2 block h-[96px] overflow-hidden rounded-md border text-left no-underline transition hover:brightness-[0.98]",
                theme.attachmentCardClassName
            )}
            onClick={(event) => event.stopPropagation()}
        >
            <div className="flex h-full w-full">
                <div className="relative h-full w-24 shrink-0 bg-slate-100 sm:w-28">
                    {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <ImageIcon className="h-5 w-5" />
                        </div>
                    )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col px-2.5 py-2">
                    <div className={cn("line-clamp-2 text-xs font-semibold leading-snug", theme.attachmentPrimaryTextClassName)}>
                        {title}
                    </div>
                    {description ? (
                        <div className={cn("mt-1 line-clamp-2 text-[11px] leading-snug", theme.attachmentMutedTextClassName)}>
                            {description}
                        </div>
                    ) : isLoading ? (
                        <div className="mt-1 space-y-1" aria-hidden="true">
                            <div className="h-2 w-11/12 rounded bg-current opacity-10" />
                            <div className="h-2 w-2/3 rounded bg-current opacity-10" />
                        </div>
                    ) : (
                        <div className="mt-1 h-[26px]" aria-hidden="true" />
                    )}
                    <div className={cn("mt-auto flex min-w-0 items-center gap-1 pt-1.5 text-[10px]", theme.attachmentMutedTextClassName)}>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{siteLabel || url}</span>
                        {overflowCount > 0 && <span className="shrink-0">+{overflowCount}</span>}
                    </div>
                </div>
            </div>
        </a>
    );
}
