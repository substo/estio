import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { resolveIntegrationAdminContext } from "@/app/(main)/admin/settings/integrations/admin-context";
import { getOpenAiTextModelPickerState } from "@/lib/ai/openai-models";
import { getChatGptSubscriptionModelPickerState, getChatGptSubscriptionSetupGuide } from "@/lib/ai/chatgpt-subscription";
import db from "@/lib/db";
import { OpenAiIntegrationForm } from "./openai-integration-form";

export default async function OpenAiIntegrationPage() {
    let context: Awaited<ReturnType<typeof resolveIntegrationAdminContext>>;
    try {
        context = await resolveIntegrationAdminContext();
    } catch {
        redirect("/sign-in");
    }

    const user = await db.user.findUnique({
        where: { clerkId: context.userId },
        select: { id: true },
    });

    if (!user?.id) {
        return <div>User not found</div>;
    }

    const [
        userOpenAiDoc,
        hasPersonalOpenAiApiKey,
        userSubscriptionDoc,
        hasChatGptSubscriptionAccessToken,
        locationAiDoc,
        hasLocationOpenAiApiKey,
        personalOpenAiPickerState,
        locationOpenAiPickerState,
    ] = await Promise.all([
        settingsService.getDocument<any>({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
        }).catch(() => null),
        settingsService.hasSecret({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
        }).catch(() => false),
        settingsService.getDocument<any>({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
        }).catch(() => null),
        settingsService.hasSecret({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
        }).catch(() => false),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
        }).catch(() => null),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: context.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
        }).catch(() => false),
        getOpenAiTextModelPickerState(context.locationId).catch(() => null),
        getOpenAiTextModelPickerState(context.locationId, { includeAuthenticatedUser: false }).catch(() => null),
    ]);

    const userSubscriptionDefaultModel = String(userSubscriptionDoc?.payload?.defaultTextModel || "").trim();
    const chatGptSubscriptionPickerState = await getChatGptSubscriptionModelPickerState(userSubscriptionDefaultModel);
    const chatGptSubscriptionSetupGuide = getChatGptSubscriptionSetupGuide();
    const locationOpenAiTextModel = String(locationAiDoc?.payload?.openAiTextModel || locationOpenAiPickerState?.defaultModel || "").trim();

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" asChild>
                    <Link href="/admin/settings/integrations" aria-label="Back to integrations">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">OpenAI</h1>
                    <p className="text-muted-foreground">
                        Connect ChatGPT subscription access and manage OpenAI fallback settings in one place.
                    </p>
                </div>
            </div>

            <OpenAiIntegrationForm
                initialData={{
                    hasPersonalOpenAiApiKey,
                    personalOpenAiEnabled: userOpenAiDoc?.payload?.enabled === true,
                    personalOpenAiDefaultTextModel: String(userOpenAiDoc?.payload?.defaultTextModel || personalOpenAiPickerState?.defaultModel || "").trim(),
                    personalOpenAiModels: personalOpenAiPickerState?.models || [],
                    hasLocationOpenAiApiKey,
                    locationOpenAiTextModel,
                    locationOpenAiModels: locationOpenAiPickerState?.models || [],
                    hasChatGptSubscriptionAccessToken,
                    chatGptSubscriptionEnabled: userSubscriptionDoc?.payload?.enabled === true,
                    chatGptSubscriptionDefaultTextModel: chatGptSubscriptionPickerState.defaultModel,
                    chatGptSubscriptionModels: chatGptSubscriptionPickerState.models,
                    chatGptSubscriptionTransportEnabled: chatGptSubscriptionSetupGuide.transportEnabled,
                    chatGptSubscriptionSetup: {
                        codexCliPath: chatGptSubscriptionSetupGuide.codexCliPath,
                        codexCwd: chatGptSubscriptionSetupGuide.codexCwd,
                        transportEnvVar: chatGptSubscriptionSetupGuide.transportEnvVar,
                        requiredTransportValue: chatGptSubscriptionSetupGuide.requiredTransportValue,
                        deviceAuthCommand: chatGptSubscriptionSetupGuide.deviceAuthCommand,
                        statusCommand: chatGptSubscriptionSetupGuide.statusCommand,
                        accessTokenCommand: chatGptSubscriptionSetupGuide.accessTokenCommand,
                    },
                }}
            />
        </div>
    );
}
