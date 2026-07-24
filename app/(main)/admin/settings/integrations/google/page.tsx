import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SyncDirectionSettings } from "./sync-direction-settings";
import { GoogleAutomationSettings } from "./automation-settings";
import { GoogleTasklistSettings } from "./tasklist-settings";
import { GoogleCalendarSettings } from "./calendar-settings";
import { listGoogleTasklists, DEFAULT_GOOGLE_TASKLIST_ID } from "@/lib/tasks/providers/google";
import { listGoogleCalendars } from "@/lib/viewings/providers/google-calendar";
import {
    getGoogleIntegrationSettingsForRead,
    googleIntegrationSettingsSelect,
} from "@/lib/google/settings";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { resolveGoogleConnectionState } from "@/lib/google/connection-state";

type GoogleTasklistOption = {
    id: string;
    title: string;
    isDefault: boolean;
};

type GoogleCalendarOption = {
    id: string;
    title: string;
    isPrimary: boolean;
};

const GOOGLE_ERROR_MESSAGE_BY_CODE: Record<string, string> = {
    invalid_state: "Connection check failed (invalid OAuth state). Please try connecting again.",
    oauth_denied: "Google authorization was denied or canceled. Please try again and approve permissions.",
    missing_code: "Google did not return an authorization code. Please retry the connection flow.",
    internal_error: "We could not complete Google connection due to a server-side issue. Please retry shortly.",
    secure_storage_unavailable: "Secure Google credential storage is temporarily unavailable. Your credentials were not replaced. Please retry after an administrator restores the encryption service.",
};

async function loadGoogleTasklistOptions(userId: string, googleSettings: any) {
    try {
        const tasklists = await listGoogleTasklists({ userId });
        return {
            tasklists: tasklists.map((tasklist): GoogleTasklistOption => ({
                id: tasklist.id,
                title: tasklist.title,
                isDefault: tasklist.isDefault,
            })),
            error: null,
        };
    } catch (error: any) {
        const fallbackTasklistId = googleSettings.googleTasklistId || DEFAULT_GOOGLE_TASKLIST_ID;
        return {
            tasklists: [{
                id: fallbackTasklistId,
                title: googleSettings.googleTasklistTitle || "Default",
                isDefault: fallbackTasklistId === DEFAULT_GOOGLE_TASKLIST_ID,
            }],
            error: error?.message || "Could not load Google tasklists. Reconnect Google to refresh permissions.",
        };
    }
}

async function loadGoogleCalendarOptions(userId: string, googleSettings: any) {
    try {
        const calendars = await listGoogleCalendars(userId);
        return {
            calendars: calendars.map((calendar): GoogleCalendarOption => ({
                id: calendar.id,
                title: calendar.title,
                isPrimary: calendar.isPrimary,
            })),
            error: null,
        };
    } catch (error: any) {
        return {
            calendars: googleSettings.googleCalendarId
                ? [{
                    id: googleSettings.googleCalendarId,
                    title: googleSettings.googleCalendarTitle || "Default Calendar",
                    isPrimary: false,
                }]
                : [],
            error: error?.message || "Could not load Google calendars. Reconnect Google to refresh calendar permissions.",
        };
    }
}

export default async function GoogleIntegrationPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) redirect("/sign-in");

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true,
            googleAccessToken: true,
            googleRefreshToken: true,
            ...googleIntegrationSettingsSelect,
        }
    });

    if (!user) {
        return <div>User not found</div>;
    }

    const googleSettings = await getGoogleIntegrationSettingsForRead(user);

    const [hasEncryptedAccessToken, hasEncryptedRefreshToken] = await Promise.all([
        settingsService.hasSecret({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
        }),
        settingsService.hasSecret({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
        }),
    ]);
    const isConnected = resolveGoogleConnectionState({
        syncEnabled: googleSettings.googleSyncEnabled,
        hasEncryptedAccessToken,
        hasEncryptedRefreshToken,
        legacyAccessToken: user.googleAccessToken,
        legacyRefreshToken: user.googleRefreshToken,
    });
    const resolvedParams = await searchParams;
    const isNewConnection = resolvedParams?.google_connected === 'true';
    const googleErrorCode = typeof resolvedParams?.google_error === "string"
        ? resolvedParams.google_error
        : null;
    const googleErrorId = typeof resolvedParams?.google_error_id === "string"
        ? resolvedParams.google_error_id
        : null;
    const googleErrorMessage = googleErrorCode
        ? (GOOGLE_ERROR_MESSAGE_BY_CODE[googleErrorCode] || "Google connection failed. Please reconnect.")
        : null;
    let tasklistLoadError: string | null = null;
    let googleTasklists: GoogleTasklistOption[] = [];

    let calendarLoadError: string | null = null;
    let googleCalendars: GoogleCalendarOption[] = [];

    if (isConnected) {
        const [tasklistResult, calendarResult] = await Promise.all([
            loadGoogleTasklistOptions(user.id, googleSettings),
            loadGoogleCalendarOptions(user.id, googleSettings),
        ]);
        googleTasklists = tasklistResult.tasklists;
        tasklistLoadError = tasklistResult.error;
        googleCalendars = calendarResult.calendars;
        calendarLoadError = calendarResult.error;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Google Workspace Sync</h1>
                <p className="text-muted-foreground">
                    Connect your Google account to sync Contacts, Gmail, and Tasks.
                </p>
            </div>

            {isNewConnection && (
                <div className="rounded-md bg-green-50 p-4 text-green-700 dark:bg-green-900/10 dark:text-green-400">
                    <div className="flex items-center">
                        <CheckCircle2 className="mr-2 h-5 w-5" />
                        <p>Successfully connected to Google!</p>
                    </div>
                </div>
            )}
            {googleErrorMessage && (
                <div className="rounded-md bg-red-50 p-4 text-red-700 dark:bg-red-900/10 dark:text-red-400">
                    <div className="flex items-center">
                        <AlertCircle className="mr-2 h-5 w-5" />
                        <p>
                            {googleErrorMessage}
                            {isConnected ? " Your existing Google connection remains active." : ""}
                            {googleErrorId ? ` (Ref: ${googleErrorId})` : ""}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Connection Status</CardTitle>
                        <CardDescription>
                            Connect your Google account to enable sync.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border p-4">
                            <div className="flex items-center space-x-3">
                                {isConnected ? (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/20">
                                        <CheckCircle2 className="h-6 w-6" />
                                    </div>
                                ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800">
                                        <XCircle className="h-6 w-6" />
                                    </div>
                                )}
                                <div>
                                    <p className="font-medium">{isConnected ? 'Connected' : 'Not Connected'}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {isConnected
                                            ? 'Google account connected. Gmail sync is active; contact and task sync follow your settings.'
                                            : 'Connect to start syncing.'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {!isConnected ? (
                            <Button asChild className="w-full">
                                <Link href="/api/google/auth">
                                    Connect Google Account
                                </Link>
                            </Button>
                        ) : (
                            <Button variant="outline" className="w-full" asChild>
                                <Link href="/api/google/auth">
                                    Reconnect / Update Permissions
                                </Link>
                            </Button>
                        )}
                        {isConnected && (
                            <p className="text-xs text-center text-muted-foreground mt-2">
                                Reconnect to grant new Gmail permissions if you haven't yet.
                            </p>
                        )}
                    </CardContent>
                </Card>

                <SyncDirectionSettings
                    currentDirection={googleSettings.googleSyncDirection}
                    isConnected={isConnected}
                />

                <GoogleAutomationSettings
                    isConnected={isConnected}
                    initialSettings={{
                        googleAutoSyncEnabled: googleSettings.googleAutoSyncEnabled,
                        googleAutoSyncLeadCapture: googleSettings.googleAutoSyncLeadCapture,
                        googleAutoSyncContactForm: googleSettings.googleAutoSyncContactForm,
                        googleAutoSyncWhatsAppInbound: googleSettings.googleAutoSyncWhatsAppInbound,
                        googleAutoSyncMode: googleSettings.googleAutoSyncMode,
                        googleAutoSyncPushUpdates: googleSettings.googleAutoSyncPushUpdates
                    }}
                />

                <GoogleTasklistSettings
                    isConnected={isConnected}
                    tasklists={googleTasklists}
                    currentTasklistId={googleSettings.googleTasklistId}
                    currentTasklistTitle={googleSettings.googleTasklistTitle}
                    loadError={tasklistLoadError}
                />

                <GoogleCalendarSettings
                    isConnected={isConnected}
                    calendars={googleCalendars}
                    currentCalendarId={googleSettings.googleCalendarId}
                    currentCalendarTitle={googleSettings.googleCalendarTitle}
                    loadError={calendarLoadError}
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Sync Features</CardTitle>
                    <CardDescription>
                        Available sync capabilities when connected.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                            <li><strong>Gmail Sync:</strong> Two-way email sync (Desktop & Mobile).</li>
                            <li><strong>Caller ID:</strong> Company field shows "Lead [Rent/Sale]..."</li>
                            <li><strong>Contact Sync:</strong> Manual by default, with optional per-flow automation.</li>
                            <li><strong>Tasks Sync-Out:</strong> Contact tasks can be pushed to a selected Google task list.</li>
                            <li><strong>Calendar Sync-Out:</strong> Viewings can be synchronized to a selected Google Calendar.</li>
                        </ul>
                    </div>

                    <div className="rounded-md bg-amber-50 p-3 text-amber-700 text-sm dark:bg-amber-900/10 dark:text-amber-400">
                        <strong>Note:</strong> Incoming calls will show the generated "Company" name as the Caller ID context.
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
