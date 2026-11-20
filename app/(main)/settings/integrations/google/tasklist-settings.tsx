"use client";

import { useMemo, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { updateGoogleTasklistSettings } from "./actions";

const DEFAULT_TASKLIST_ID = "@default";

type TasklistOption = {
    id: string;
    title: string;
    isDefault?: boolean;
};

interface GoogleTasklistSettingsProps {
    isConnected: boolean;
    tasklists: TasklistOption[];
    currentTasklistId: string | null;
    currentTasklistTitle: string | null;
    loadError?: string | null;
}

export function GoogleTasklistSettings({
    isConnected,
    tasklists,
    currentTasklistId,
    currentTasklistTitle,
    loadError
}: GoogleTasklistSettingsProps) {
    const [isPending, startTransition] = useTransition();
    const [selectedTasklistId, setSelectedTasklistId] = useState(currentTasklistId || DEFAULT_TASKLIST_ID);
    const [saveError, setSaveError] = useState<string | null>(null);

    const options = useMemo(() => {
        const byId = new Map<string, TasklistOption>();
        for (const item of tasklists) {
            if (!item?.id) continue;
            byId.set(item.id, {
                id: item.id,
                title: item.title || "Untitled List",
                isDefault: item.isDefault || item.id === DEFAULT_TASKLIST_ID,
            });
        }

        if (!byId.has(DEFAULT_TASKLIST_ID)) {
            byId.set(DEFAULT_TASKLIST_ID, {
                id: DEFAULT_TASKLIST_ID,
                title: currentTasklistTitle || "Default",
                isDefault: true,
            });
        }

        return Array.from(byId.values()).sort((a, b) => {
            if (a.isDefault && !b.isDefault) return -1;
            if (!a.isDefault && b.isDefault) return 1;
            return a.title.localeCompare(b.title);
        });
    }, [tasklists, currentTasklistTitle]);

    const handleTasklistChange = (value: string) => {
        const previous = selectedTasklistId;
        setSelectedTasklistId(value);
        setSaveError(null);

        const selected = options.find((option) => option.id === value);

        startTransition(async () => {
            try {
                await updateGoogleTasklistSettings({
                    tasklistId: value,
                    tasklistTitle: selected?.title || null,
                });
            } catch (error: any) {
                setSelectedTasklistId(previous);
                setSaveError(error?.message || "Failed to save tasklist setting");
            }
        });
    };

    if (!isConnected) {
        return (
            <Card className="opacity-60">
                <CardHeader>
                    <CardTitle>Google Tasks Sync-Out</CardTitle>
                    <CardDescription>
                        Connect your Google account first to choose where contact tasks are synced.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Google Tasks Sync-Out
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </CardTitle>
                <CardDescription>
                    Select the Google task list used when tasks from Mission Control are pushed to Google Tasks.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label className="text-sm font-medium">Target Google Task List</Label>
                    <Select
                        value={selectedTasklistId}
                        onValueChange={handleTasklistChange}
                        disabled={isPending || options.length === 0}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select task list" />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                    {option.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {loadError ? (
                    <div className="rounded-md bg-amber-50 p-3 text-amber-700 text-sm dark:bg-amber-900/10 dark:text-amber-400">
                        <strong>Tasklists not loaded:</strong> {loadError}
                    </div>
                ) : null}

                {saveError ? (
                    <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm dark:bg-red-900/10 dark:text-red-400">
                        <strong>Save failed:</strong> {saveError}
                    </div>
                ) : null}

                <div className="rounded-md bg-blue-50 p-3 text-blue-700 text-sm dark:bg-blue-900/10 dark:text-blue-400">
                    Existing Google-synced tasks stay on their original task list. New tasks use the selected list.
                </div>
            </CardContent>
        </Card>
    );
}
