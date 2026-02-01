import Link from "next/link";
import { MessageSquare } from "lucide-react";

export default function IntegrationsPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
                <p className="text-muted-foreground">Manage your external service connections.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* WhatsApp Integration Card */}
                <Link href="/admin/settings/integrations/whatsapp" className="group block h-full">
                    <div className="flex h-full flex-col justify-between rounded-lg border p-6 transition-colors hover:border-primary hover:bg-muted/50">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400">
                                    <MessageSquare className="h-6 w-6" />
                                </div>
                                <h3 className="font-semibold text-lg">WhatsApp Business</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Connect your WhatsApp Business Account to send and receive messages directly from the dashboard.
                            </p>
                        </div>
                        <div className="mt-6 flex items-center text-sm font-medium text-primary group-hover:underline">
                            Configure Integration &rarr;
                        </div>
                    </div>
                </Link>

                {/* GoHighLevel Integration Card */}
                <Link href="/admin/settings/integrations/ghl" className="group block h-full">
                    <div className="flex h-full flex-col justify-between rounded-lg border p-6 transition-colors hover:border-primary hover:bg-muted/50">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400">
                                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                                        <path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z" />
                                    </svg>
                                </div>
                                <h3 className="font-semibold text-lg">GoHighLevel</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Manage the connection to your GoHighLevel location, specific tokens, and syncing preferences.
                            </p>
                        </div>
                        <div className="mt-6 flex items-center text-sm font-medium text-primary group-hover:underline">
                            Configure Integration &rarr;
                        </div>
                    </div>
                </Link>

                {/* Google Contacts Integration Card */}
                <Link href="/admin/settings/integrations/google" className="group block h-full">

                    <div className="flex h-full flex-col justify-between rounded-lg border p-6 transition-colors hover:border-primary hover:bg-muted/50">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z" />
                                    </svg>
                                </div>
                                <h3 className="font-semibold text-lg">Google Workspace</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Sync Contacts and Gmail (Two-Way) to manage leads and communication.
                            </p>
                        </div>
                        <div className="mt-6 flex items-center text-sm font-medium text-primary group-hover:underline">
                            Configure Integration &rarr;
                        </div>
                    </div>
                </Link>

                {/* Microsoft / Outlook Integration Card */}
                <Link href="/admin/settings/integrations/microsoft" className="group block h-full">
                    <div className="flex h-full flex-col justify-between rounded-lg border p-6 transition-colors hover:border-primary hover:bg-muted/50">
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                        <path d="M2 4v16h10V4H2zm9 14H3V6h8v12zm2-14v16h9V4h-9zm8 14h-7V6h7v12z" />
                                    </svg>
                                </div>
                                <h3 className="font-semibold text-lg">Microsoft Outlook</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Sync Emails and Contacts with Outlook (Personal or Office 365).
                            </p>
                        </div>
                        <div className="mt-6 flex items-center text-sm font-medium text-primary group-hover:underline">
                            Configure Integration &rarr;
                        </div>
                    </div>
                </Link>
            </div>
        </div>
    );
}
