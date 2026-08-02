"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function DisconnectGoogleButton() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [isPending, setIsPending] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [isError, setIsError] = useState(false);

    async function disconnect() {
        setIsPending(true);
        setMessage(null);
        setIsError(false);
        try {
            const response = await fetch("/api/google/disconnect", { method: "POST" });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || "Google could not be disconnected.");
            }
            setMessage(result.externalWarning
                ? `Google was disconnected locally. ${result.externalWarning}`
                : "Google was disconnected successfully.");
            setIsOpen(false);
            router.replace(
                `/admin/settings/integrations/google?google_disconnected=true${result.externalWarning ? "&google_revoke_warning=true" : ""}`
            );
            router.refresh();
        } catch (error) {
            setIsError(true);
            setMessage(error instanceof Error ? error.message : "Google could not be disconnected.");
        } finally {
            setIsPending(false);
        }
    }

    return (
        <div className="space-y-2">
            <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
                <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" className="w-full">
                        Disconnect Google
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect your Google account?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes your saved Google credentials and stops Gmail, Contacts, Tasks,
                            and Calendar sync. Estio contacts, conversations, messages, tasks, viewings,
                            and history will not be deleted.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isPending}
                            onClick={(event) => {
                                event.preventDefault();
                                void disconnect();
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isPending ? "Disconnecting…" : "Disconnect Google"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {message && (
                <p role={isError ? "alert" : "status"} className={isError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                    {message}
                </p>
            )}
        </div>
    );
}
