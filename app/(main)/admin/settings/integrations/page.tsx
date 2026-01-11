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
            </div>
        </div>
    );
}
