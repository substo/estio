"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { updateGoogleAutomationSettings, type GoogleAutoSyncMode } from "./actions";

interface AutomationSettings {
    googleAutoSyncEnabled: boolean;
    googleAutoSyncLeadCapture: boolean;
    googleAutoSyncContactForm: boolean;
    googleAutoSyncWhatsAppInbound: boolean;
    googleAutoSyncMode: string;
    googleAutoSyncPushUpdates: boolean;
}

interface GoogleAutomationSettingsProps {
    isConnected: boolean;
    initialSettings: AutomationSettings;
}

export function GoogleAutomationSettings({ isConnected, initialSettings }: GoogleAutomationSettingsProps) {
    const [isPending, startTransition] = useTransition();
    const [settings, setSettings] = useState({
        ...initialSettings,
        googleAutoSyncMode: (initialSettings.googleAutoSyncMode || "LINK_ONLY") as GoogleAutoSyncMode
    });

    const patchSettings = (patch: Partial<typeof settings>) => {
        const previous = settings;
        const next = { ...settings, ...patch };
        setSettings(next);

        startTransition(async () => {
            try {
                await updateGoogleAutomationSettings({
                    enabled: patch.googleAutoSyncEnabled,
                    leadCapture: patch.googleAutoSyncLeadCapture,
                    contactForm: patch.googleAutoSyncContactForm,
                    whatsappInbound: patch.googleAutoSyncWhatsAppInbound,
                    mode: patch.googleAutoSyncMode,
                    pushUpdates: patch.googleAutoSyncPushUpdates
                });
            } catch {
                setSettings(previous);
            }
        });
    };

    if (!isConnected) {
        return (
            <Card className="opacity-60">
                <CardHeader>
                    <CardTitle>Contact Automation</CardTitle>
                    <CardDescription>
                        Connect your Google account first to configure automatic contact sync.
                    </CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    Contact Automation
                    {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                </CardTitle>
                <CardDescription>
                    Manual sync remains the default. Enable only the flows you trust.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-1">
                        <Label className="text-sm font-medium">Enable Google Contact Automation</Label>
                        <p className="text-sm text-muted-foreground">
                            Master switch for all automatic contact sync behavior.
                        </p>
                    </div>
                    <Switch
                        checked={settings.googleAutoSyncEnabled}
                        onCheckedChange={(checked) => patchSettings({ googleAutoSyncEnabled: checked })}
                    />
                </div>

                <div className={`space-y-4 ${settings.googleAutoSyncEnabled ? "" : "opacity-60 pointer-events-none"}`}>
                    <div className="space-y-3 rounded-lg border p-4">
                        <Label className="text-sm font-medium">Automation Sources</Label>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">Lead Capture</p>
                                <p className="text-xs text-muted-foreground">New Conversation + Paste Lead</p>
                            </div>
                            <Switch
                                checked={settings.googleAutoSyncLeadCapture}
                                onCheckedChange={(checked) => patchSettings({ googleAutoSyncLeadCapture: checked })}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">Contact Form</p>
                                <p className="text-xs text-muted-foreground">Manual create/update in Contacts</p>
                            </div>
                            <Switch
                                checked={settings.googleAutoSyncContactForm}
                                onCheckedChange={(checked) => patchSettings({ googleAutoSyncContactForm: checked })}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium">WhatsApp Inbound</p>
                                <p className="text-xs text-muted-foreground">Webhook-created contacts from inbound chat</p>
                            </div>
                            <Switch
                                checked={settings.googleAutoSyncWhatsAppInbound}
                                onCheckedChange={(checked) => patchSettings({ googleAutoSyncWhatsAppInbound: checked })}
                            />
                        </div>
                    </div>

                    <div className="space-y-3 rounded-lg border p-4">
                        <Label className="text-sm font-medium">Create Behavior</Label>
                        <RadioGroup
                            value={settings.googleAutoSyncMode}
                            onValueChange={(value) => patchSettings({ googleAutoSyncMode: value as GoogleAutoSyncMode })}
                            className="space-y-3"
                        >
                            <div className="flex items-start space-x-3 rounded-md border p-3">
                                <RadioGroupItem value="LINK_ONLY" id="link-only" className="mt-0.5" />
                                <div className="space-y-1">
                                    <Label htmlFor="link-only" className="cursor-pointer">
                                        Link Only (Recommended)
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Search Google by phone/email and link if found. Never create.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-start space-x-3 rounded-md border p-3">
                                <RadioGroupItem value="LINK_OR_CREATE" id="link-or-create" className="mt-0.5" />
                                <div className="space-y-1">
                                    <Label htmlFor="link-or-create" className="cursor-pointer">
                                        Link or Create
                                    </Label>
                                    <p className="text-xs text-muted-foreground">
                                        Search first, then create a new Google contact if no duplicate exists.
                                    </p>
                                </div>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-1">
                            <Label className="text-sm font-medium">Push Updates for Linked Contacts</Label>
                            <p className="text-xs text-muted-foreground">
                                When local data changes, push updates only for contacts already linked to Google.
                            </p>
                        </div>
                        <Switch
                            checked={settings.googleAutoSyncPushUpdates}
                            onCheckedChange={(checked) => patchSettings({ googleAutoSyncPushUpdates: checked })}
                        />
                    </div>
                </div>

                {!settings.googleAutoSyncEnabled && (
                    <div className="rounded-md bg-blue-50 p-3 text-blue-700 text-sm dark:bg-blue-900/10 dark:text-blue-400">
                        <strong>Manual Sync Only:</strong> Contacts are synced only when you use the Google Sync Manager.
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
