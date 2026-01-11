'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import PageWrapper from '@/components/wrapper/page-wrapper';
import { CheckCircle, Copy, ExternalLink, Info } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

export default function SetupPage() {
    const [copied, setCopied] = useState(false);
    // Use the production URL directly to avoid confusion
    const ssoUrl = `https://estio.co/sso/init?locationId={{location.id}}&userId={{user.id}}&userEmail={{user.email}}`;

    const copyToClipboard = () => {
        navigator.clipboard.writeText(ssoUrl).then(() => {
            setCopied(true);
            toast.success("URL copied to clipboard!");
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <PageWrapper>
            <div className="flex flex-col justify-center items-center w-full min-h-[80vh] p-4">
                <div className="max-w-4xl w-full space-y-8">
                    <div className="text-center space-y-4">
                        <h1 className="text-4xl font-bold tracking-tight">
                            Install Estio
                        </h1>
                        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                            Add the app to your GoHighLevel agency in 2 minutes. This one-time setup works for all your sub-accounts.
                        </p>
                        <div className="pt-4">
                            <Link href="/admin">
                                <Button size="lg" className="animate-buttonheartbeat">
                                    Get Started / Login
                                </Button>
                            </Link>
                        </div>
                    </div>

                    <Card className="shadow-xl border-border/50 bg-card/50 backdrop-blur-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <span className="bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center text-sm">1</span>
                                Copy the Magic Link
                            </CardTitle>
                            <CardDescription>
                                This link uses "Merge Tags" to automatically identify your users.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="relative group">
                                <div className="bg-muted/50 border rounded-lg p-4 font-mono text-sm break-all pr-24">
                                    {ssoUrl}
                                </div>
                                <div className="absolute right-2 top-2">
                                    <Button
                                        onClick={copyToClipboard}
                                        size="sm"
                                        variant={copied ? "default" : "secondary"}
                                        className="gap-2"
                                    >
                                        {copied ? <CheckCircle className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="shadow-xl border-border/50 bg-card/50 backdrop-blur-sm">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <span className="bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center text-sm">2</span>
                                Add to GoHighLevel
                            </CardTitle>
                            <CardDescription>
                                Follow these steps in your Agency Dashboard
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-4">
                                    <div className="flex gap-3">
                                        <div className="flex-none mt-1">
                                            <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">A</div>
                                        </div>
                                        <div>
                                            <p className="font-medium">Go to Agency Settings</p>
                                            <p className="text-sm text-muted-foreground">Log in to app.gohighlevel.com and click Settings (bottom left)</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="flex-none mt-1">
                                            <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">B</div>
                                        </div>
                                        <div>
                                            <p className="font-medium">Open Custom Menu Links</p>
                                            <p className="text-sm text-muted-foreground">Find "Custom Menu Links" in the left sidebar</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-3">
                                        <div className="flex-none mt-1">
                                            <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold">C</div>
                                        </div>
                                        <div>
                                            <p className="font-medium">Create New Link</p>
                                            <p className="text-sm text-muted-foreground">Click the "+ Create New" button</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-muted/30 rounded-lg p-4 text-sm space-y-3 border">
                                    <p className="font-semibold mb-2">Use these settings:</p>
                                    <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                                        <span className="text-muted-foreground">Icon:</span>
                                        <span>🏠 (House/Building)</span>

                                        <span className="text-muted-foreground">Link Title:</span>
                                        <span className="font-medium">Estio</span>

                                        <span className="text-muted-foreground">URL:</span>
                                        <span className="text-blue-600 dark:text-blue-400 font-medium">(Paste the Magic Link)</span>

                                        <span className="text-muted-foreground">Show on:</span>
                                        <span>All Accounts</span>

                                        <span className="text-muted-foreground">Open in:</span>
                                        <span>Current Window (or iFrame)</span>

                                        <span className="text-muted-foreground">Show to:</span>
                                        <span className="font-bold text-orange-600 dark:text-orange-400">Agency Admins & Account Admins (Recommended)</span>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-6 flex gap-4 items-start">
                        <Info className="h-6 w-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
                        <div>
                            <h3 className="font-semibold text-blue-900 dark:text-blue-100">What happens next?</h3>
                            <p className="text-blue-800 dark:text-blue-200 mt-1 text-sm">
                                The link will appear in all your sub-accounts immediately. When you or your clients click it for the first time, you'll see a one-time authorization screen. After that, everyone gets signed in automatically!
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </PageWrapper>
    );
}
