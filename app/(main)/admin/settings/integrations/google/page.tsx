
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function GoogleIntegrationPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) redirect("/sign-in");

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, googleAccessToken: true, googleRefreshToken: true, googleSyncEnabled: true }
    });

    if (!user) {
        return <div>User not found</div>;
    }

    const isConnected = !!user.googleAccessToken;
    const resolvedParams = await searchParams;
    const isNewConnection = resolvedParams?.google_connected === 'true';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Google Contacts Sync</h1>
                <p className="text-muted-foreground">
                    Two-way synchronization with your Google Contacts.
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
                                            ? 'Your Google Contacts are being synced.'
                                            : 'Connect to start syncing contacts.'}
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
                                    Reconnect Account
                                </Link>
                            </Button>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Sync Settings</CardTitle>
                        <CardDescription>
                            Configure how your contacts are synchronized.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <h4 className="font-medium text-sm">Features</h4>
                            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                                <li><strong>Caller ID:</strong> Company field shows "Lead [Rent/Sale]..."</li>
                                <li><strong>Two-Way:</strong> Updates in Estio push to Google.</li>
                                <li><strong>Notes:</strong> Lead requirements stored in Notes.</li>
                            </ul>
                        </div>

                        <div className="rounded-md bg-amber-50 p-3 text-amber-700 text-sm dark:bg-amber-900/10 dark:text-amber-400">
                            <strong>Note:</strong> Incoming calls will show the generated "Company" name as the Caller ID context.
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
