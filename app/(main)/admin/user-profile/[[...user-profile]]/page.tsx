import config from "@/config";
import { UserProfile } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { UserProfileForm } from "../_components/user-profile-form";
import { WhatsAppVerification } from "../_components/whatsapp-verification";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { getOpenAiTextModelPickerState } from "@/lib/ai/openai-models";
import { getChatGptSubscriptionModelPickerState, getChatGptSubscriptionSetupGuide } from "@/lib/ai/chatgpt-subscription";

const UserProfilePage = async () => {
    if (!config?.auth?.enabled) {
        redirect('/admin');
    }

    const user = await currentUser();

    // Fetch local user details to populate the form
    // We assume the user exists in DB properly via sync, but fallback gracefully
    let dbUser = null;
    let hasUserOpenAiApiKey = false;
    let openAiEnabled = false;
    let openAiDefaultTextModel = "";
    let openAiModels: Array<{ value: string; label: string; description?: string }> = [];
    let hasChatGptSubscriptionAccessToken = false;
    let chatGptSubscriptionEnabled = false;
    let chatGptSubscriptionDefaultTextModel = "";
    let chatGptSubscriptionModels: Array<{ value: string; label: string; description?: string }> = [];
    if (user) {
        dbUser = await db.user.findUnique({
            where: { clerkId: user.id },
            select: {
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                timeZone: true,
                id: true
            }
        });

        if (dbUser) {
            const [openAiDoc, openAiSecretConfigured, chatGptSubscriptionDoc, chatGptSubscriptionSecretConfigured] = await Promise.all([
                settingsService.getDocument<any>({
                    scopeType: "USER",
                    scopeId: dbUser.id,
                    domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                }).catch(() => null),
                settingsService.hasSecret({
                    scopeType: "USER",
                    scopeId: dbUser.id,
                    domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                }).catch(() => false),
                settingsService.getDocument<any>({
                    scopeType: "USER",
                    scopeId: dbUser.id,
                    domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                }).catch(() => null),
                settingsService.hasSecret({
                    scopeType: "USER",
                    scopeId: dbUser.id,
                    domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                }).catch(() => false),
            ]);
            hasUserOpenAiApiKey = openAiSecretConfigured;
            openAiEnabled = openAiDoc?.payload?.enabled === true;
            openAiDefaultTextModel = String(openAiDoc?.payload?.defaultTextModel || "").trim();
            hasChatGptSubscriptionAccessToken = chatGptSubscriptionSecretConfigured;
            chatGptSubscriptionEnabled = chatGptSubscriptionDoc?.payload?.enabled === true;
            chatGptSubscriptionDefaultTextModel = String(chatGptSubscriptionDoc?.payload?.defaultTextModel || "").trim();
        }
    }

    const openAiPickerState = await getOpenAiTextModelPickerState(undefined).catch(() => null);
    openAiModels = openAiPickerState?.models || [];
    if (!openAiDefaultTextModel) {
        openAiDefaultTextModel = openAiPickerState?.defaultModel || "";
    }
    const chatGptSubscriptionPickerState = await getChatGptSubscriptionModelPickerState(chatGptSubscriptionDefaultTextModel);
    chatGptSubscriptionModels = chatGptSubscriptionPickerState.models;
    if (!chatGptSubscriptionDefaultTextModel) {
        chatGptSubscriptionDefaultTextModel = chatGptSubscriptionPickerState.defaultModel;
    }
    const chatGptSubscriptionSetupGuide = getChatGptSubscriptionSetupGuide();

    const initialData = {
        firstName: dbUser?.firstName || user?.firstName || '',
        lastName: dbUser?.lastName || user?.lastName || '',
        phone: dbUser?.phone || '',
        email: dbUser?.email || user?.emailAddresses[0]?.emailAddress || '',
        timeZone: dbUser?.timeZone || '',
        hasUserOpenAiApiKey,
        openAiEnabled,
        openAiDefaultTextModel,
        openAiModels,
        hasChatGptSubscriptionAccessToken,
        chatGptSubscriptionEnabled,
        chatGptSubscriptionDefaultTextModel,
        chatGptSubscriptionModels,
        chatGptSubscriptionTransportEnabled: chatGptSubscriptionSetupGuide.transportEnabled,
        chatGptSubscriptionSetupGuide,
    };

    return (
        <div className="flex flex-col items-center justify-start p-6 space-y-8 w-full max-w-5xl mx-auto">
            <div className="w-full space-y-6">
                <UserProfileForm initialData={initialData} />
                <WhatsAppVerification />
            </div>

            <div className="w-full flex justify-center">
                <UserProfile path="/admin/user-profile" routing="path" />
            </div>
        </div>
    )
}


export default UserProfilePage;
