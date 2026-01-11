"use client";

import { Switch } from "@/components/ui/switch";
import { useState, useTransition } from "react";
import { savePublicListingEnabled } from "../actions";
import { toast } from "sonner";

export function PublicListingToggle({ initialValue }: { initialValue: boolean }) {
    const [enabled, setEnabled] = useState(initialValue);
    const [isPending, startTransition] = useTransition();

    const handleToggle = (checked: boolean) => {
        setEnabled(checked);
        startTransition(async () => {
            try {
                await savePublicListingEnabled(checked);
                toast.success(checked ? "Public listings enabled" : "Public listings disabled");
            } catch (error) {
                setEnabled(!checked); // Revert
                toast.error("Failed to update setting");
            }
        });
    };

    return (
        <Switch
            checked={enabled}
            onCheckedChange={handleToggle}
            disabled={isPending}
        />
    );
}
