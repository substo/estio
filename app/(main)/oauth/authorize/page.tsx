import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import PageWrapper from "@/components/wrapper/page-wrapper";
import { AlertCircle, ArrowRight, CheckCircle, Info } from "lucide-react";
import Link from "next/link";

export default async function OAuthAuthorizePage({
    searchParams,
}: {
    searchParams: Promise<{ locationId?: string; agencyId?: string }>;
}) {
    const params = await searchParams;
    const { locationId, agencyId } = params;

    // Build the continue URL
    const continueUrl = `/api/oauth/start?proceed=true${locationId ? `&locationId=${locationId}` : ''}${agencyId ? `&agencyId=${agencyId}` : ''}`;

    return (
        <PageWrapper>
            <div className="flex flex-col justify-center items-center w-full min-h-[80vh] p-4">
                <Card className="max-w-3xl w-full shadow-xl border-border/50 bg-card/50 backdrop-blur-sm">
                    <CardHeader className="space-y-3 text-center pb-8">
                        <div className="mx-auto p-3 bg-blue-100 dark:bg-blue-900/50 rounded-full mb-2 w-fit">
                            <Info className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                        </div>
                        <CardTitle className="text-3xl">One-Time Setup Required</CardTitle>
                        <CardDescription className="text-lg mt-2 max-w-lg mx-auto">
                            We need to connect your GoHighLevel account to enable the Estio instance.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-8">
                        {/* Visual Timeline */}
                        <div className="relative">
                            <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-200 dark:bg-gray-800" />
                            <div className="grid grid-cols-3 gap-4 relative z-10">
                                {/* Step 1 */}
                                <div className="flex flex-col items-center text-center space-y-2">
                                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-lg ring-4 ring-background">1</div>
                                    <div className="font-semibold text-sm">Start</div>
                                    <div className="text-xs text-muted-foreground px-2">Click the button below</div>
                                </div>
                                {/* Step 2 */}
                                <div className="flex flex-col items-center text-center space-y-2">
                                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 text-muted-foreground flex items-center justify-center font-bold text-sm shadow-lg ring-4 ring-background">2</div>
                                    <div className="font-semibold text-sm">Authorize</div>
                                    <div className="text-xs text-muted-foreground px-2">
                                        Log in to <strong>leadconnectorhq.com</strong> if prompted
                                    </div>
                                </div>
                                {/* Step 3 */}
                                <div className="flex flex-col items-center text-center space-y-2">
                                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-800 text-muted-foreground flex items-center justify-center font-bold text-sm shadow-lg ring-4 ring-background">3</div>
                                    <div className="font-semibold text-sm">Done</div>
                                    <div className="text-xs text-muted-foreground px-2">Return here & refresh</div>
                                </div>
                            </div>
                        </div>

                        {/* Important Note */}
                        <div className="bg-amber-50/50 dark:bg-amber-950/30 p-6 rounded-xl border border-amber-200/50 dark:border-amber-800/50">
                            <h3 className="font-semibold text-amber-900 dark:text-amber-100 mb-3 flex items-center gap-2 text-base">
                                <AlertCircle className="h-5 w-5" />
                                Important: If you're already logged in, log out and then log back in to <strong>leadconnectorhq.com</strong> again.
                            </h3>
                            <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
                                For security, GoHighLevel uses a separate domain (<strong>leadconnectorhq.com</strong>) for authorization.
                                {/* Since this is a different domain, you are asked to log in again, even if you are already logged into your CRM. */}
                            </p>
                        </div>

                        {/* Action Button */}
                        <div className="pt-2">
                            <Link href={continueUrl} className="w-full block" target="_blank">
                                <Button className="w-full h-14 text-lg font-medium shadow-lg hover:shadow-xl transition-all" size="lg">
                                    Open Authorization Page
                                    <ArrowRight className="ml-2 h-5 w-5" />
                                </Button>
                            </Link>
                            <p className="text-xs text-center text-muted-foreground mt-4">
                                This will open a new tab. After authorizing, you can close that tab and refresh this page.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </PageWrapper>
    );
}
