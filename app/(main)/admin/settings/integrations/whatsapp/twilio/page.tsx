import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getWhatsAppSettings } from "../actions";
import { WhatsAppNav } from "../whatsapp-nav";

export default async function TwilioUnavailablePage() {
    const settings = await getWhatsAppSettings(null);
    const hasLegacyConfiguration = Boolean(settings.twilioAccountSid || settings.twilioWhatsAppFrom || settings.hasTwilioAuthToken);

    return (
        <div className="max-w-3xl space-y-6">
            <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight">Twilio is not currently available</h1>
                    <Badge variant="secondary">Not available</Badge>
                </div>
                <p className="text-muted-foreground">Twilio is a legacy, experimental connection and is not supported for new production setup.</p>
            </div>
            <WhatsAppNav />

            {hasLegacyConfiguration && (
                <Alert>
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                    <AlertTitle>Existing legacy configuration detected</AlertTitle>
                    <AlertDescription>Your saved Twilio configuration has not been changed. No credentials or provider settings were activated, cleared, or updated by opening this page.</AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Use the supported connection</CardTitle>
                    <CardDescription>The linked-phone connection supports normal customer conversations and is the recommended setup.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Link href="/admin/settings/integrations/whatsapp/linked-phone" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Connect your WhatsApp phone
                    </Link>
                </CardContent>
            </Card>
        </div>
    );
}
