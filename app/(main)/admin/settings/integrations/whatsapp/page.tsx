import Link from "next/link";
import { ArrowRight, Building2, MessageCircle, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWhatsAppSettings } from "./actions";
import { getFriendlyLinkedPhoneStatus } from "./linked-phone-status";
import { WhatsAppNav } from "./whatsapp-nav";

export default async function WhatsAppOverviewPage() {
    const settings = await getWhatsAppSettings(null);
    const phoneStatus = getFriendlyLinkedPhoneStatus(settings).label;
    const phoneConnected = phoneStatus === "Connected";
    const hasLegacyTwilio = Boolean(settings.twilioAccountSid || settings.twilioWhatsAppFrom || settings.hasTwilioAuthToken);

    return (
        <div className="max-w-5xl space-y-6">
            <div className="space-y-2">
                <h1 className="text-2xl font-bold tracking-tight">Connect WhatsApp</h1>
                <p className="text-muted-foreground">Choose how this location sends and receives WhatsApp messages.</p>
            </div>
            <WhatsAppNav />

            <div className="grid gap-4 lg:grid-cols-3">
                <Link href="/admin/settings/integrations/whatsapp/linked-phone" className="group block lg:col-span-2">
                    <Card className="h-full border-2 border-green-500/70 bg-green-50/50 shadow-sm transition-colors group-hover:border-green-600 dark:bg-green-950/10">
                        <CardHeader>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <span className="rounded-full bg-green-100 p-3 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                                        <MessageCircle className="h-6 w-6" aria-hidden="true" />
                                    </span>
                                    <CardTitle>Connect your WhatsApp phone</CardTitle>
                                </div>
                                <Badge className="bg-green-600">Recommended</Badge>
                            </div>
                            <CardDescription className="text-base text-foreground/80">
                                Scan a QR code from WhatsApp on your phone. This is the easiest option for normal customer conversations.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">Uses a linked WhatsApp device (Web Bridge).</p>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="font-medium" aria-label={`Linked phone status: ${phoneStatus}`}>{phoneStatus}</span>
                                <span className="inline-flex min-h-10 items-center font-medium text-green-700 group-hover:underline dark:text-green-300">
                                    {phoneConnected ? "Manage connection" : "Connect phone"}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                                </span>
                            </div>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/admin/settings/integrations/whatsapp/meta" className="group block">
                    <Card className="h-full transition-colors group-hover:border-primary">
                        <CardHeader>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <Building2 className="h-6 w-6 text-blue-600" aria-hidden="true" />
                                <Badge variant="outline">Advanced · Beta</Badge>
                            </div>
                            <CardTitle>Meta business connection</CardTitle>
                            <CardDescription>For approved message templates and official Meta business features. Technical setup may be required.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">Uses the WhatsApp Business Cloud API.</p>
                            <span className="inline-flex min-h-10 items-center font-medium text-primary group-hover:underline">
                                Open advanced setup<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                            </span>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/admin/settings/integrations/whatsapp/twilio" className="group block lg:col-start-3">
                    <Card className="h-full bg-muted/30 transition-colors group-hover:border-muted-foreground/50">
                        <CardHeader>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <TriangleAlert className="h-6 w-6 text-amber-600" aria-hidden="true" />
                                <Badge variant="secondary">Not available</Badge>
                            </div>
                            <CardTitle>Twilio</CardTitle>
                            <CardDescription>This connection is not currently supported for new setup.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {hasLegacyTwilio && <p className="text-sm text-muted-foreground">An existing legacy configuration was detected and has not been changed.</p>}
                            <span className="inline-flex min-h-10 items-center text-sm font-medium group-hover:underline">View availability details</span>
                        </CardContent>
                    </Card>
                </Link>
            </div>
        </div>
    );
}
