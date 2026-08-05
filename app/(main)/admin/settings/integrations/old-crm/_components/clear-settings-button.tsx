"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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

type ClearSettingsButtonProps = {
    title: string;
    items: readonly string[];
    onClear: () => Promise<boolean>;
    disabled?: boolean;
};

export function ClearSettingsButton({ title, items, onClear, disabled = false }: ClearSettingsButtonProps) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);

    async function clear() {
        setPending(true);
        try {
            if (await onClear()) setOpen(false);
        } finally {
            setPending(false);
        }
    }

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!pending) setOpen(nextOpen);
            }}
        >
            <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={disabled} className="text-destructive hover:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2">
                            <p>This clears:</p>
                            <ul className="list-disc space-y-1 pl-5">
                                {items.map((item) => <li key={item}>{item}</li>)}
                            </ul>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={pending}
                        onClick={(event) => {
                            event.preventDefault();
                            void clear();
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {pending ? "Clearing…" : "Clear settings"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
