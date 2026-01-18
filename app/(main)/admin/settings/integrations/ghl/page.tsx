"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RefreshCw, CheckCircle2, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function GHLSettingsPage() {
    return (
        <div className="space-y-6 max-w-4xl">
            <div className="flex items-center space-x-4">
                <Link href="/admin/settings/integrations">
                    <Button variant="ghost" size="icon">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">GoHighLevel Configuration</h1>
                    <p className="text-muted-foreground">Manage your connection to GoHighLevel.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Connection Status</CardTitle>
                    <CardDescription>
                        Manage your tokens and connection state.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <AlertTitle className="text-green-800 dark:text-green-200">Connected</AlertTitle>
                        <AlertDescription className="text-green-700 dark:text-green-300">
                            Your location is currently linked.
                        </AlertDescription>
                    </Alert>

                    <div className="space-y-2 pt-4 border-t">
                        <h4 className="text-sm font-medium">Re-authenticate</h4>
                        <p className="text-sm text-muted-foreground">
                            If you are experiencing sync issues, token expiration errors, or need to specificially refresh your permissions, click below to re-run the authorization flow. This will overwrite your existing tokens without data loss.
                        </p>
                        <Button
                            onClick={() => window.location.href = "/api/oauth/start?proceed=true"}
                            className="mt-2"
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reconnect Now
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
