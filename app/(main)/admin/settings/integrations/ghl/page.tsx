import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
    AlertCircle,
    ArrowLeft,
    CheckCircle2,
    PlugZap,
    RefreshCw,
    TriangleAlert,
    Unplug,
    XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { getGhlConnectionHealth, type GhlConnectionHealth } from "@/lib/ghl/connection-health";
import { disconnectGhlIntegration } from "./actions";

function formatDate(value: string | Date | null | undefined) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(value));
}

function getStatusCopy(health: GhlConnectionHealth) {
    switch (health.status) {
        case "connected":
            return {
                title: "Connected",
                description: health.remoteLocationName
                    ? `Linked to ${health.remoteLocationName}.`
                    : "GoHighLevel connection is healthy.",
                icon: CheckCircle2,
                alertClass: "border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/20 dark:text-green-200",
                badge: "default" as const,
            };
        case "broken":
            return {
                title: "Broken Connection",
                description: health.reason,
                icon: AlertCircle,
                alertClass: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200",
                badge: "destructive" as const,
            };
        case "unknown":
            return {
                title: "Status Unknown",
                description: health.reason,
                icon: TriangleAlert,
                alertClass: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200",
                badge: "secondary" as const,
            };
        default:
            return {
                title: "Not Connected",
                description: health.reason,
                icon: XCircle,
                alertClass: "border-muted bg-muted/30 text-foreground",
                badge: "outline" as const,
            };
    }
}

export default async function GHLSettingsPage() {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");

    const location = await getLocationContext();
    if (!location?.id) {
        return (
            <div className="max-w-4xl space-y-6">
                <h1 className="text-2xl font-bold tracking-tight">GoHighLevel Configuration</h1>
                <Alert variant="destructive">
                    <AlertCircle className="h-5 w-5" />
                    <AlertTitle>No location found</AlertTitle>
                    <AlertDescription>Choose or create a location before configuring GoHighLevel.</AlertDescription>
                </Alert>
            </div>
        );
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, location.id);
    if (!isAdmin) {
        return (
            <div className="max-w-4xl space-y-6">
                <h1 className="text-2xl font-bold tracking-tight">GoHighLevel Configuration</h1>
                <Alert variant="destructive">
                    <AlertCircle className="h-5 w-5" />
                    <AlertTitle>Admin access required</AlertTitle>
                    <AlertDescription>Only location admins can manage this GoHighLevel connection.</AlertDescription>
                </Alert>
            </div>
        );
    }

    const health = await getGhlConnectionHealth(location);
    const statusCopy = getStatusCopy(health);
    const StatusIcon = statusCopy.icon;
    const reconnectHref = `/api/oauth/start?proceed=true&internalLocationId=${encodeURIComponent(location.id)}&locationId=${encodeURIComponent(health.ghlLocationId || "")}&agencyId=${encodeURIComponent(health.ghlAgencyId || "")}`;
    const hasStoredIdentifiers = Boolean(health.ghlLocationId || health.ghlAgencyId);

    return (
        <div className="max-w-4xl space-y-6">
            <div className="flex items-center gap-4">
                <Button asChild variant="ghost" size="icon">
                    <Link href="/admin/settings/integrations" aria-label="Back to integrations">
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">GoHighLevel Configuration</h1>
                    <p className="text-muted-foreground">Manage your connection to GoHighLevel.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle>Connection Status</CardTitle>
                            <CardDescription>Verify tokens, remote location access, and connection state.</CardDescription>
                        </div>
                        <Badge variant={statusCopy.badge} className="w-fit">
                            {health.status.replace("_", " ")}
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Alert className={statusCopy.alertClass}>
                        <StatusIcon className="h-5 w-5" />
                        <AlertTitle>{statusCopy.title}</AlertTitle>
                        <AlertDescription>{statusCopy.description}</AlertDescription>
                    </Alert>

                    <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                        <div>
                            <p className="text-muted-foreground">Estio location</p>
                            <p className="font-medium">{location.name || location.id}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">GHL location id</p>
                            <p className="font-mono text-xs">{health.ghlLocationId || "-"}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Token expires</p>
                            <p>{formatDate(health.expiresAt)}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Last checked</p>
                            <p>{formatDate(health.checkedAt)}</p>
                        </div>
                    </div>

                    <div className="space-y-3 border-t pt-4">
                        <div>
                            <h4 className="text-sm font-medium">
                                {health.status === "not_connected" ? "Connect GoHighLevel" : "Re-authenticate"}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                                {health.status === "not_connected"
                                    ? "Start the authorization flow to link this Estio location to a GoHighLevel location."
                                    : "Reconnect to refresh tokens, recover revoked access, or grant updated permissions."}
                            </p>
                        </div>
                        <Button asChild>
                            <Link href={reconnectHref}>
                                {health.status === "not_connected" ? (
                                    <PlugZap className="mr-2 h-4 w-4" />
                                ) : (
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                {health.status === "not_connected" ? "Connect GoHighLevel" : "Reconnect Now"}
                            </Link>
                        </Button>
                    </div>

                    {health.status !== "not_connected" && (
                        <div className="space-y-3 border-t pt-4">
                            <div>
                                <h4 className="text-sm font-medium">Disconnect</h4>
                                <p className="text-sm text-muted-foreground">
                                    Remove Estio's GoHighLevel tokens for this location. Local contacts, conversations, properties, and sync history remain unchanged.
                                </p>
                            </div>
                            <form action={disconnectGhlIntegration}>
                                <Button type="submit" variant="destructive">
                                    <Unplug className="mr-2 h-4 w-4" />
                                    Disconnect GoHighLevel
                                </Button>
                            </form>
                        </div>
                    )}

                    {health.status === "not_connected" && hasStoredIdentifiers && (
                        <div className="space-y-3 border-t pt-4">
                            <div>
                                <h4 className="text-sm font-medium">Clear saved GHL identifiers</h4>
                                <p className="text-sm text-muted-foreground">
                                    Use this only when you want to remove the saved GHL location and agency ids from this Estio location.
                                </p>
                            </div>
                            <form action={disconnectGhlIntegration}>
                                <input type="hidden" name="mode" value="full_unlink" />
                                <Button type="submit" variant="outline">
                                    Clear Saved Identifiers
                                </Button>
                            </form>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
