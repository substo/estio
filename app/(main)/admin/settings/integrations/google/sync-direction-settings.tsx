"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { updateGoogleSyncDirection } from "./actions";
import { Loader2 } from "lucide-react";

interface SyncDirectionSettingsProps {
    currentDirection: string | null;
    isConnected: boolean;
}

export function SyncDirectionSettings({ currentDirection, isConnected }: SyncDirectionSettingsProps) {
    const [isPending, startTransition] = useTransition();
    const [value, setValue] = useState(currentDirection || "ESTIO_TO_GOOGLE");

    const handleChange = (newValue: string) => {
        setValue(newValue);
        startTransition(async () => {
            await updateGoogleSyncDirection(newValue);
        });
    };

    if (!isConnected) {
        return (
            <Card className="opacity-60">
                <CardHeader>
                    <CardTitle>Source of Truth</CardTitle>
                    <CardDescription>
                        Connect your Google account first to configure sync direction.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Source of Truth
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                </CardTitle>
                <CardDescription>
                    Choose which platform's data takes priority during sync.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <RadioGroup value={value} onValueChange={handleChange} className="space-y-3">
                    <div className="flex items-start space-x-3 rounded-lg border p-4 hover:bg-muted/50 cursor-pointer">
                        <RadioGroupItem value="ESTIO_TO_GOOGLE" id="estio" className="mt-0.5" />
                        <div className="space-y-1">
                            <Label htmlFor="estio" className="font-medium cursor-pointer">
                                Estio is Source of Truth
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Push contacts from Estio to Google Contacts. Estio data will overwrite Google.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start space-x-3 rounded-lg border p-4 hover:bg-muted/50 cursor-pointer">
                        <RadioGroupItem value="GOOGLE_TO_ESTIO" id="google" className="mt-0.5" />
                        <div className="space-y-1">
                            <Label htmlFor="google" className="font-medium cursor-pointer">
                                Google is Source of Truth
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Pull contacts from Google Contacts to Estio. Google data will overwrite Estio.
                            </p>
                        </div>
                    </div>
                </RadioGroup>

                <div className="rounded-md bg-blue-50 p-3 text-blue-700 text-sm dark:bg-blue-900/10 dark:text-blue-400">
                    <strong>Sync Direction applies to manual actions first:</strong> automation behavior is configured in the
                    Contact Automation card.
                </div>
            </CardContent>
        </Card>
    );
}
