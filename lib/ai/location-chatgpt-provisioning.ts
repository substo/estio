import db from "@/lib/db";
import { validateChatGptSubscriptionConnection } from "@/lib/ai/chatgpt-subscription";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

export type WorkspaceAccountType = "business" | "enterprise";

export type ProvisionLocationChatGptInput = {
    locationId: string;
    actorUserId: string;
    accessToken: string;
    accountType: WorkspaceAccountType;
    workspaceLabel: string;
    dryRun?: boolean;
};

export type ProvisionLocationChatGptResult = {
    locationId: string;
    accountType: WorkspaceAccountType;
    workspaceLabel: string;
    verifiedAt: string;
    stored: boolean;
};

type ProvisioningDependencies = {
    authorize: (input: Pick<ProvisionLocationChatGptInput, "locationId" | "actorUserId">) => Promise<boolean>;
    validate: (accessToken: string) => Promise<boolean>;
    persist: (input: ProvisionLocationChatGptInput & { verifiedAt: string }) => Promise<void>;
    now: () => Date;
};

function cleanRequired(value: string, label: string, maxLength: number): string {
    const normalized = String(value || "").trim();
    if (!normalized) throw new Error(`${label} is required.`);
    if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
    return normalized;
}

export function buildLocationChatGptConnectionPayload(input: {
    existingPayload?: Record<string, unknown> | null;
    accountType: WorkspaceAccountType;
    workspaceLabel: string;
    actorUserId: string;
    verifiedAt: string;
}) {
    const existingPayload = input.existingPayload || {};
    const previous = existingPayload.chatGptSubscription && typeof existingPayload.chatGptSubscription === "object"
        ? existingPayload.chatGptSubscription as Record<string, unknown>
        : {};
    return {
        ...existingPayload,
        pendingDeviceAttemptId: null,
        chatGptSubscription: {
            ...previous,
            enabled: true,
            credentialKind: "workspace_access_token",
            eligibility: "business_or_enterprise_automation",
            identityMasked: input.workspaceLabel,
            planType: input.accountType,
            verifiedAt: input.verifiedAt,
            health: "connected",
            connectedByUserId: input.actorUserId,
            provisioningMode: "approved_operator",
            usageLimits: null,
        },
    };
}

const defaultDependencies: ProvisioningDependencies = {
    authorize: async ({ locationId, actorUserId }) => {
        const [location, role] = await Promise.all([
            db.location.findUnique({ where: { id: locationId }, select: { id: true } }),
            db.userLocationRole.findUnique({
                where: { userId_locationId: { userId: actorUserId, locationId } },
                select: { role: true },
            }),
        ]);
        return Boolean(location?.id) && role?.role === "ADMIN";
    },
    validate: async (accessToken) => {
        const status = await validateChatGptSubscriptionConnection({ accessToken });
        return status.ok;
    },
    persist: async (input) => {
        const document = await settingsService.getDocument<Record<string, unknown>>({
            scopeType: "LOCATION",
            scopeId: input.locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null);
        const payload = buildLocationChatGptConnectionPayload({
            existingPayload: document?.payload,
            accountType: input.accountType,
            workspaceLabel: input.workspaceLabel,
            actorUserId: input.actorUserId,
            verifiedAt: input.verifiedAt,
        });

        await db.$transaction(async (tx) => {
            await settingsService.setSecret({
                scopeType: "LOCATION",
                scopeId: input.locationId,
                domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                plaintext: input.accessToken,
                actorUserId: input.actorUserId,
                tx,
            });
            await settingsService.upsertDocument({
                scopeType: "LOCATION",
                scopeId: input.locationId,
                domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                payload,
                actorUserId: input.actorUserId,
                expectedVersion: document?.version ?? 0,
                schemaVersion: 1,
                tx,
            });
        });
    },
    now: () => new Date(),
};

export async function provisionLocationChatGptAccessToken(
    rawInput: ProvisionLocationChatGptInput,
    overrides: Partial<ProvisioningDependencies> = {}
): Promise<ProvisionLocationChatGptResult> {
    const input: ProvisionLocationChatGptInput = {
        locationId: cleanRequired(rawInput.locationId, "Location ID", 128),
        actorUserId: cleanRequired(rawInput.actorUserId, "Actor user ID", 128),
        accessToken: cleanRequired(rawInput.accessToken, "Codex access token", 8192),
        accountType: rawInput.accountType,
        workspaceLabel: cleanRequired(rawInput.workspaceLabel, "Workspace label", 120),
        dryRun: rawInput.dryRun === true,
    };
    if (!(["business", "enterprise"] as string[]).includes(input.accountType)) {
        throw new Error("Account type must be business or enterprise.");
    }

    const dependencies = { ...defaultDependencies, ...overrides };
    if (!await dependencies.authorize(input)) {
        throw new Error("The attributed user is not an admin of this location.");
    }
    if (!await dependencies.validate(input.accessToken)) {
        throw new Error("OpenAI did not accept this Business or Enterprise Codex access token.");
    }

    const verifiedAt = dependencies.now().toISOString();
    if (!input.dryRun) {
        await dependencies.persist({ ...input, verifiedAt });
    }
    return {
        locationId: input.locationId,
        accountType: input.accountType,
        workspaceLabel: input.workspaceLabel,
        verifiedAt,
        stored: !input.dryRun,
    };
}
