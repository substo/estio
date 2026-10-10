"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SessionTrashAction({ id, trashed }: { id: string; trashed: boolean }) {
    const router = useRouter();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");

    async function handleClick() {
        if (!trashed && !window.confirm("Move this session to Trash? You can restore it for 30 days.")) return;
        setPending(true);
        setError("");
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(id)}/trash`, {
                method: trashed ? "DELETE" : "POST",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Could not update session.");
            router.refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update session.");
        } finally {
            setPending(false);
        }
    }

    return (
        <div className="flex flex-col items-end gap-1">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={handleClick}>
                {pending ? "Working…" : trashed ? "Restore" : "Delete"}
            </Button>
            {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
        </div>
    );
}
