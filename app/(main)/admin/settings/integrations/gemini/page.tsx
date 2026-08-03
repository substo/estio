import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveIntegrationAdminContext } from "../admin-context";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import db from "@/lib/db";
import { LocationAiKeyForm } from "../location-ai-key-form";
import { saveGeminiIntegration } from "../ai-provider-actions";

export default async function GeminiIntegrationPage() {
    let context: Awaited<ReturnType<typeof resolveIntegrationAdminContext>>;
    try { context = await resolveIntegrationAdminContext(); } catch { redirect("/sign-in"); }
    const [saved, legacy] = await Promise.all([
        settingsService.hasSecret({ scopeType: "LOCATION", scopeId: context.locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY }).catch(() => false),
        db.siteConfig.findUnique({ where: { locationId: context.locationId }, select: { googleAiApiKey: true } }),
    ]);
    return <div className="max-w-3xl space-y-6">
        <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11" asChild><Link href="/admin/settings/integrations" aria-label="Back to integrations"><ArrowLeft className="h-5 w-5" /></Link></Button>
            <div><h1 className="text-2xl font-bold">Google Gemini</h1><p className="text-muted-foreground">Shared by everyone at this location</p></div>
        </div>
        <section className="rounded-lg border p-6 space-y-4">
            <div><h2 className="font-semibold">Location connection</h2><p className="text-sm text-muted-foreground">Create a restricted Gemini API key in Google AI Studio, then save it here. Only location admins can change it.</p></div>
            <a className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Open Google AI Studio</a>
            <LocationAiKeyForm provider="Gemini" hasKey={saved || Boolean(legacy?.googleAiApiKey)} action={saveGeminiIntegration} />
        </section>
    </div>;
}
