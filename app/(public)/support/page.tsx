import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, MessageCircle, FileText } from "lucide-react";

export default function SupportPage() {
    return (
        <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center p-4">
            <div className="max-w-2xl w-full space-y-8">
                <div className="text-center space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">Estio Support</h1>
                    <p className="text-muted-foreground">
                        We&apos;re here to help you get the most out of your real estate engine.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Mail className="h-5 w-5 text-primary" />
                                Email Support
                            </CardTitle>
                            <CardDescription>
                                Get direct help from our engineering team.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                                We typically respond within 24 hours.
                            </p>
                            <Button asChild variant="outline" className="w-full">
                                <a href="mailto:support@estio.co">support@estio.co</a>
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5 text-primary" />
                                Documentation
                            </CardTitle>
                            <CardDescription>
                                Guides on GHL integration & usage.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground mb-4">
                                Read our detailed setup guides.
                            </p>
                            <Button asChild className="w-full">
                                <Link href="/docs">View Documentation</Link>
                            </Button>
                        </CardContent>
                    </Card>
                </div>

                <div className="text-center text-sm text-neutral-500">
                    <p>Need urgent help?</p>
                    <p>Monday - Friday, 9AM - 5PM GMT</p>
                </div>
            </div>
        </div>
    );
}
