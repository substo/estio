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
import { updateGoogleCalendarSettings } from "./actions";

type CalendarOption = {
    id: string;
    title: string;
    isPrimary?: boolean;
};

interface GoogleCalendarSettingsProps {
    isConnected: boolean;
    calendars: CalendarOption[];
    currentCalendarId: string | null;
    currentCalendarTitle: string | null;
    loadError?: string | null;
}

export function GoogleCalendarSettings({
    isConnected,
    calendars,
    currentCalendarId,
    currentCalendarTitle,
    loadError
}: GoogleCalendarSettingsProps) {
    const [isPending, startTransition] = useTransition();
    // Default to the user's saved ID, or find the primary calendar from the list
    const defaultId = currentCalendarId || calendars.find(c => c.isPrimary)?.id || (calendars.length > 0 ? calendars[0].id : "");
    const [selectedCalendarId, setSelectedCalendarId] = useState(defaultId);
    const [saveError, setSaveError] = useState<string | null>(null);

    const options = useMemo(() => {
        const byId = new Map<string, CalendarOption>();
        for (const item of calendars) {
            if (!item?.id) continue;
            byId.set(item.id, {
                id: item.id,
                title: item.title || "Untitled Calendar",
                isPrimary: item.isPrimary,
            });
        }

        // If the current saved calendar is not in the list, add it as a fallback
        if (currentCalendarId && !byId.has(currentCalendarId)) {
            byId.set(currentCalendarId, {
                id: currentCalendarId,
                title: currentCalendarTitle || "Unknown Calendar",
                isPrimary: false,
            });
        }

        return Array.from(byId.values()).sort((a, b) => {
            if (a.isPrimary && !b.isPrimary) return -1;
            if (!a.isPrimary && b.isPrimary) return 1;
            return a.title.localeCompare(b.title);
        });
    }, [calendars, currentCalendarId, currentCalendarTitle]);

    const handleCalendarChange = (value: string) => {
        const previous = selectedCalendarId;
        setSelectedCalendarId(value);
        setSaveError(null);

        const selected = options.find((option) => option.id === value);

        startTransition(async () => {
            try {
                await updateGoogleCalendarSettings({
                    calendarId: value,
                    calendarTitle: selected?.title || null,
                });
            } catch (error: any) {
                setSelectedCalendarId(previous);
                setSaveError(error?.message || "Failed to save calendar setting");
            }
        });
    };

    if (!isConnected) {
        return (
            <Card className="opacity-60">
                <CardHeader>
                    <CardTitle>Google Calendar Sync</CardTitle>
                    <CardDescription>
                        Connect your Google account first to choose where Viewings are synced.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Google Calendar Sync
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                </CardTitle>
                <CardDescription>
                    Select the Google Calendar used when Viewings from Mission Control are pushed to Google.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label className="text-sm font-medium">Target Google Calendar</Label>
                    <Select
                        value={selectedCalendarId}
                        onValueChange={handleCalendarChange}
                        disabled={isPending || options.length === 0}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select calendar" />
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
                        <strong>Calendars not loaded:</strong> {loadError}
                    </div>
                ) : null}

                {saveError ? (
                    <div className="rounded-md bg-red-50 p-3 text-red-700 text-sm dark:bg-red-900/10 dark:text-red-400">
                        <strong>Save failed:</strong> {saveError}
                    </div>
                ) : null}

                <div className="rounded-md bg-blue-50 p-3 text-blue-700 text-sm dark:bg-blue-900/10 dark:text-blue-400">
                    Existing Google-synced viewings stay on their original calendar. New viewings use the selected calendar.
                </div>
            </CardContent>
        </Card>
    );
}
