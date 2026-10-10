"use client";

import { useRef, useState, type ReactNode, type TouchEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type SessionCardProps = {
    id: string;
    trashed: boolean;
    active: boolean;
    trashDays: number;
    details: ReactNode;
    badges: ReactNode;
};

export function SessionCard({ id, trashed, active, trashDays, details, badges }: SessionCardProps) {
    const router = useRouter();
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const suppressNextClick = useRef(false);
    const [revealed, setRevealed] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    const canSwipe = !trashed && !active;

    function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
        suppressNextClick.current = false;
        touchStart.current = null;
        if (!canSwipe || dialogOpen || event.touches.length !== 1) return;
        touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }

    function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || event.changedTouches.length !== 1) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        event.preventDefault(); // A swipe starting on the session link must not open it.
        suppressNextClick.current = true;
        setRevealed(dx < 0);
    }

    async function updateSession() {
        if (pending) return;
        setPending(true);
        setError("");
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(id)}/trash`, {
                method: trashed ? "DELETE" : "POST",
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not update session.");
            setDialogOpen(false);
            setRevealed(false);
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update session.");
        } finally {
            setPending(false);
        }
    }

    function handleAction() {
        setError("");
        if (trashed) {
            void updateSession();
        } else {
            setDialogOpen(true);
        }
    }

    return (
        <div className="relative overflow-hidden rounded-lg">
            {canSwipe && (
                <button
                    type="button"
                    aria-label="Move session to Trash"
                    aria-hidden={!revealed}
                    tabIndex={revealed ? 0 : -1}
                    disabled={pending}
                    className="absolute inset-y-0 right-0 flex w-[88px] items-center justify-center gap-1 bg-destructive text-xs font-medium text-destructive-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
                    onClick={handleAction}
                >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                </button>
            )}
            <div
                className={`relative flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 transition-transform duration-200 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${revealed ? "-translate-x-[88px]" : ""} ${canSwipe ? "touch-pan-y" : ""}`}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={() => { touchStart.current = null; }}
                onClickCapture={(event) => {
                    if (suppressNextClick.current) {
                        suppressNextClick.current = false;
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                    if (revealed) {
                        event.preventDefault();
                        event.stopPropagation();
                        setRevealed(false);
                    }
                }}
            >
                <div className="min-w-0 space-y-1">{details}</div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    {badges}
                    <TooltipProvider delayDuration={200}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    disabled={pending}
                                    aria-label={trashed ? "Restore session" : active ? "End session before moving to Trash" : "Move session to Trash"}
                                    className="ml-auto h-11 w-11 shrink-0 text-muted-foreground hover:text-destructive sm:ml-0"
                                    onClick={handleAction}
                                >
                                    {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : trashed ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>{trashed ? "Restore session" : active ? "End session before moving to Trash" : "Move to Trash"}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                {trashed && error && <p role="alert" className="text-xs text-destructive sm:basis-full">{error}</p>}
            </div>

            {!trashed && (
                <AlertDialog open={dialogOpen} onOpenChange={(open) => {
                    if (pending) return;
                    setDialogOpen(open);
                    if (!open) setError("");
                }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Move session to Trash?</AlertDialogTitle>
                            <AlertDialogDescription>
                                {active ? "End the live session before moving it to Trash. " : ""}
                                Sessions in Trash can be restored for {trashDays} days. After that, their content is removed automatically.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                        <AlertDialogFooter>
                            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                                disabled={pending || active}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={(event) => {
                                    event.preventDefault();
                                    void updateSession();
                                }}
                            >
                                {pending ? "Moving…" : "Move to Trash"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            )}
        </div>
    );
}
