import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveIntegrationMemberContext } from "../admin-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { ChatGptConnectionPanel } from "./chatgpt-connection-panel";

export default async function ChatGptSubscriptionPage() {
    let context: Awaited<ReturnType<typeof resolveIntegrationMemberContext>>;
    try { context = await resolveIntegrationMemberContext(); } catch { redirect("/sign-in"); }
    const user = await db.user.findUnique({ where: { clerkId: context.userId }, select: { id: true } });
    if (!user?.id) return <div>User not found.</div>;
    const [isAdmin, personal, location, hasPersonalCredential, hasLocationCredential] = await Promise.all([
        verifyUserIsLocationAdmin(context.userId, context.locationId),
        settingsService.getDocument<any>({ scopeType: "USER", scopeId: user.id, domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS }).catch(() => null),
        settingsService.getDocument<any>({ scopeType: "LOCATION", scopeId: context.locationId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS }).catch(() => null),
        settingsService.hasSecret({ scopeType: "USER", scopeId: user.id, domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS, secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE }).catch(() => false),
        settingsService.hasSecret({ scopeType: "LOCATION", scopeId: context.locationId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN }).catch(() => false),
    ]);
    const locationConnection = location?.payload?.chatGptSubscription || {};
    return <div className="max-w-4xl space-y-6">
        <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" className="min-h-11 min-w-11" asChild><Link href="/admin/settings/integrations" aria-label="Back to integrations"><ArrowLeft className="h-5 w-5" /></Link></Button>
            <div><h1 className="text-2xl font-bold">ChatGPT subscription (Codex)</h1><p className="text-muted-foreground">Use ChatGPT subscription limits for supported interactive text tasks.</p></div>
        </div>
        <section className="rounded-lg border p-6 space-y-4">
            <div><h2 className="text-lg font-semibold">Location connection</h2><p className="text-sm text-muted-foreground">Shared by everyone at this location. Only a ChatGPT Business or Enterprise Codex access token documented by OpenAI can be location-owned; a personal browser login is never promoted to shared use.</p></div>
            <p className="text-sm text-muted-foreground">Browser sign-in checks the account without exposing credentials. Personal results can be saved under My connection. A shared Business or Enterprise connection requires approved Estio provisioning.</p>
            <ChatGptConnectionPanel scope="LOCATION" canManage={isAdmin} connected={locationConnection.enabled === true && locationConnection.health === "connected" && hasLocationCredential} identity={locationConnection.identityMasked} planType={locationConnection.planType} verifiedAt={locationConnection.verifiedAt} health={locationConnection.health} usageLimits={locationConnection.usageLimits} />
            {!isAdmin && <p className="text-sm text-muted-foreground">A location admin manages this connection.</p>}
        </section>
        <section id="my-chatgpt-connection" className="scroll-mt-6 rounded-lg border p-6 space-y-4">
            <div><h2 className="text-lg font-semibold">My connection</h2><p className="text-sm text-muted-foreground">Only used by you. It is never used for scheduled work or another person’s requests.</p></div>
            <ChatGptConnectionPanel scope="USER" canManage connected={personal?.payload?.enabled === true && personal?.payload?.health === "connected" && Boolean(personal?.payload?.verifiedAt) && hasPersonalCredential} identity={personal?.payload?.emailMasked} planType={personal?.payload?.planType} verifiedAt={personal?.payload?.verifiedAt} health={personal?.payload?.health} usageLimits={personal?.payload?.usageLimits} preferMyConnection={personal?.payload?.preferMyConnection === true} />
        </section>
    </div>;
}
