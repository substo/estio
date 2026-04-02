
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
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, isSettingsReadFromNewEnabled } from "@/lib/settings/constants";

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
            googleSyncEnabled: true,
            googleSyncDirection: true,
            googleAutoSyncEnabled: true,
            googleAutoSyncLeadCapture: true,
            googleAutoSyncContactForm: true,
            googleAutoSyncWhatsAppInbound: true,
            googleAutoSyncMode: true,
            googleAutoSyncPushUpdates: true,
            googleTasklistId: true,
            googleTasklistTitle: true,
            googleCalendarId: true,
            googleCalendarTitle: true,
        }
    });

    if (!user) {
        return <div>User not found</div>;
    }

    const googleSettingsDoc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });
    const googleSettings = googleSettingsDoc?.payload || {};
    const useNewReadPath = isSettingsReadFromNewEnabled();

    const resolvedGoogleSyncDirection =
        (useNewReadPath ? googleSettings.googleSyncDirection : undefined) ??
        user.googleSyncDirection;
    const resolvedGoogleAutoSyncEnabled =
        (useNewReadPath ? googleSettings.googleAutoSyncEnabled : undefined) ??
        user.googleAutoSyncEnabled;
    const resolvedGoogleAutoSyncLeadCapture =
        (useNewReadPath ? googleSettings.googleAutoSyncLeadCapture : undefined) ??
        user.googleAutoSyncLeadCapture;
    const resolvedGoogleAutoSyncContactForm =
        (useNewReadPath ? googleSettings.googleAutoSyncContactForm : undefined) ??
        user.googleAutoSyncContactForm;
    const resolvedGoogleAutoSyncWhatsAppInbound =
        (useNewReadPath ? googleSettings.googleAutoSyncWhatsAppInbound : undefined) ??
        user.googleAutoSyncWhatsAppInbound;
    const resolvedGoogleAutoSyncMode =
        (useNewReadPath ? googleSettings.googleAutoSyncMode : undefined) ??
        user.googleAutoSyncMode;
    const resolvedGoogleAutoSyncPushUpdates =
        (useNewReadPath ? googleSettings.googleAutoSyncPushUpdates : undefined) ??
        user.googleAutoSyncPushUpdates;
    const resolvedGoogleTasklistId =
        (useNewReadPath ? googleSettings.googleTasklistId : undefined) ??
        user.googleTasklistId;
    const resolvedGoogleTasklistTitle =
        (useNewReadPath ? googleSettings.googleTasklistTitle : undefined) ??
        user.googleTasklistTitle;
    const resolvedGoogleCalendarId =
        (useNewReadPath ? googleSettings.googleCalendarId : undefined) ??
        user.googleCalendarId;
    const resolvedGoogleCalendarTitle =
        (useNewReadPath ? googleSettings.googleCalendarTitle : undefined) ??
        user.googleCalendarTitle;

    const isConnected = !!user.googleAccessToken;
    const resolvedParams = await searchParams;
    const isNewConnection = resolvedParams?.google_connected === 'true';
    const googleErrorCode = typeof resolvedParams?.google_error === "string"
        ? resolvedParams.google_error
        : null;
    const googleErrorId = typeof resolvedParams?.google_error_id === "string"
        ? resolvedParams.google_error_id
        : null;
    const googleErrorMessageByCode: Record<string, string> = {
        invalid_state: "Connection check failed (invalid OAuth state). Please try connecting again.",
        oauth_denied: "Google authorization was denied or canceled. Please try again and approve permissions.",
        missing_code: "Google did not return an authorization code. Please retry the connection flow.",
        internal_error: "We could not complete Google connection due to a server-side issue. Please retry shortly.",
    };
    const googleErrorMessage = googleErrorCode
        ? (googleErrorMessageByCode[googleErrorCode] || "Google connection failed. Please reconnect.")
        : null;
    let tasklistLoadError: string | null = null;
    let googleTasklists: Array<{ id: string; title: string; isDefault: boolean }> = [];

    let calendarLoadError: string | null = null;
    let googleCalendars: Array<{ id: string; title: string; isPrimary: boolean }> = [];

    if (isConnected) {
        try {
            const loadedTasklists = await listGoogleTasklists({ userId: user.id });
            googleTasklists = loadedTasklists.map((tasklist) => ({
                id: tasklist.id,
                title: tasklist.title,
                isDefault: tasklist.isDefault,
            }));
        } catch (error: any) {
            tasklistLoadError = error?.message || "Could not load Google tasklists. Reconnect Google to refresh permissions.";
            googleTasklists = [{
                id: resolvedGoogleTasklistId || DEFAULT_GOOGLE_TASKLIST_ID,
                title: resolvedGoogleTasklistTitle || "Default",
                isDefault: (resolvedGoogleTasklistId || DEFAULT_GOOGLE_TASKLIST_ID) === DEFAULT_GOOGLE_TASKLIST_ID,
            }];
        }

        try {
            const loadedCalendars = await listGoogleCalendars(user.id);
            googleCalendars = loadedCalendars.map((calendar) => ({
                id: calendar.id,
                title: calendar.title,
                isPrimary: calendar.isPrimary,
            }));
        } catch (error: any) {
            calendarLoadError = error?.message || "Could not load Google calendars. Reconnect Google to refresh calendar permissions.";
            if (resolvedGoogleCalendarId) {
                googleCalendars = [{
                    id: resolvedGoogleCalendarId,
                    title: resolvedGoogleCalendarTitle || "Default Calendar",
                    isPrimary: false,
                }];
            }
        }
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
                        <p>{googleErrorMessage}{googleErrorId ? ` (Ref: ${googleErrorId})` : ""}</p>
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
                    currentDirection={resolvedGoogleSyncDirection}
                    isConnected={isConnected}
                />

                <GoogleAutomationSettings
                    isConnected={isConnected}
                    initialSettings={{
                        googleAutoSyncEnabled: resolvedGoogleAutoSyncEnabled,
                        googleAutoSyncLeadCapture: resolvedGoogleAutoSyncLeadCapture,
                        googleAutoSyncContactForm: resolvedGoogleAutoSyncContactForm,
                        googleAutoSyncWhatsAppInbound: resolvedGoogleAutoSyncWhatsAppInbound,
                        googleAutoSyncMode: resolvedGoogleAutoSyncMode || "LINK_ONLY",
                        googleAutoSyncPushUpdates: resolvedGoogleAutoSyncPushUpdates
                    }}
                />

                <GoogleTasklistSettings
                    isConnected={isConnected}
                    tasklists={googleTasklists}
                    currentTasklistId={resolvedGoogleTasklistId}
                    currentTasklistTitle={resolvedGoogleTasklistTitle}
                    loadError={tasklistLoadError}
                />

                <GoogleCalendarSettings
                    isConnected={isConnected}
                    calendars={googleCalendars}
                    currentCalendarId={resolvedGoogleCalendarId}
                    currentCalendarTitle={resolvedGoogleCalendarTitle}
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
