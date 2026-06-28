import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveIntegrationAdminContext } from "@/app/(main)/admin/settings/integrations/admin-context";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
    resolveChatGptSubscriptionDefaultModel,
    validateChatGptSubscriptionConnection,
} from "@/lib/ai/chatgpt-subscription";

const OPENAI_INTEGRATION_PATH = "/admin/settings/integrations/openai";
const AI_SETTINGS_PATH = "/admin/settings/ai";

async function resolveLocalUserId(clerkUserId: string): Promise<string> {
    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true },
    });
    if (!user?.id) throw new Error("User not found.");
    return user.id;
}

function revalidateOpenAiSettings() {
    revalidatePath(OPENAI_INTEGRATION_PATH);
    revalidatePath(AI_SETTINGS_PATH);
    revalidatePath("/admin/user-profile");
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const operation = String(body?.operation || "").trim();
        const defaultTextModel = resolveChatGptSubscriptionDefaultModel(body?.modelId);

        if (operation !== "connect" && operation !== "disconnect") {
            return NextResponse.json({ success: false, error: "Unsupported ChatGPT subscription operation." }, { status: 400 });
        }

        const { userId: clerkUserId } = await resolveIntegrationAdminContext();
        const userId = await resolveLocalUserId(clerkUserId);

        if (operation === "connect") {
            const status = await validateChatGptSubscriptionConnection({ modelId: defaultTextModel });
            if (!status.ok) {
                return NextResponse.json({ success: false, error: status.message }, { status: 502 });
            }
        }

        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            payload: {
                enabled: operation === "connect",
                defaultTextModel,
            },
            actorUserId: userId,
            schemaVersion: 1,
        });

        revalidateOpenAiSettings();

        return NextResponse.json({
            success: true,
            message: operation === "connect"
                ? "ChatGPT subscription connected and enabled."
                : "ChatGPT subscription disconnected.",
        });
    } catch (error: any) {
        console.error("[OpenAI Integration] Subscription API failed:", error);
        const message = error?.message || "ChatGPT subscription operation failed.";
        const status = message === "Unauthorized" ? 401 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
    }
}
