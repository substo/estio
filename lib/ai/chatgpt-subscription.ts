import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { buildIsolatedCodexEnvironment } from "@/lib/ai/codex-environment";

export const CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX = "chatgpt_subscription:";
export const CHATGPT_SUBSCRIPTION_DEFAULT_MODEL = "gpt-5.4-mini";
export const CHATGPT_SUBSCRIPTION_IMAGE_MODEL = "gpt-image-2";

export type ChatGptSubscriptionModelOption = {
    value: string;
    label: string;
    description?: string;
};

export const CHATGPT_SUBSCRIPTION_TEXT_MODELS: ChatGptSubscriptionModelOption[] = [
    {
        value: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4-mini`,
        label: "ChatGPT Subscription GPT-5.4 Mini",
        description: "Fastest lower-usage Codex/ChatGPT subscription-backed text agent model",
    },
    {
        value: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.5`,
        label: "ChatGPT Subscription GPT-5.5",
        description: "Codex/ChatGPT subscription-backed text agent model",
    },
    {
        value: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4`,
        label: "ChatGPT Subscription GPT-5.4",
        description: "Codex/ChatGPT subscription-backed text agent model",
    },
];

export const CHATGPT_SUBSCRIPTION_IMAGE_MODELS: ChatGptSubscriptionModelOption[] = [
    {
        value: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}${CHATGPT_SUBSCRIPTION_IMAGE_MODEL}`,
        label: "ChatGPT Subscription GPT Image 2",
        description: "Codex/ChatGPT subscription-backed image generation",
    },
];

export type ChatGptSubscriptionUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    raw: string;
};

export type ChatGptSubscriptionResult = {
    text: string;
    model: string;
    usage: ChatGptSubscriptionUsage;
    fundingScope: ChatGptFundingScope;
};

export type ChatGptFundingScope = "user_chatgpt" | "location_chatgpt" | "estio_global";
export type ChatGptExecutionMode = "interactive" | "background";

export type ChatGptExecutionContext = {
    executionMode: ChatGptExecutionMode;
    locationId?: string | null;
    userId?: string | null;
    allowEstioGlobal?: boolean;
};

type ResolvedChatGptCredential = {
    fundingScope: ChatGptFundingScope;
    executionKey?: string | null;
    defaultTextModel?: string | null;
    accessToken?: string | null;
    authCache?: string | null;
    persistAuthCache?: (authCache: string) => Promise<void>;
    markUnhealthy?: () => Promise<void>;
};

const credentialExecutionTails = new Map<string, Promise<void>>();

async function withCredentialExecutionLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = credentialExecutionTails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => current);
    credentialExecutionTails.set(key, tail);
    await previous.catch(() => undefined);
    try {
        return await action();
    } finally {
        release();
        if (credentialExecutionTails.get(key) === tail) credentialExecutionTails.delete(key);
    }
}

export function chooseChatGptFundingScope(input: {
    executionMode: ChatGptExecutionMode;
    personalAvailable: boolean;
    locationAvailable: boolean;
    globalAvailable: boolean;
}): ChatGptFundingScope | null {
    if (input.executionMode === "interactive" && input.personalAvailable) return "user_chatgpt";
    if (input.locationAvailable) return "location_chatgpt";
    if (input.globalAvailable) return "estio_global";
    return null;
}

export function isEligibleLocationChatGptConnection(connection: any): boolean {
    const credentialKind = String(connection?.credentialKind || "");
    const eligibility = String(connection?.eligibility || "");
    const workspaceCredential = ["workspace_access_token", "enterprise_access_token"].includes(credentialKind)
        && ["business_or_enterprise_automation", "workspace_automation", "enterprise_automation"].includes(eligibility);
    const locationOwnedCredential = credentialKind === "managed_chatgpt"
        && eligibility === "location_owned_subscription";
    return connection?.enabled === true
        && (workspaceCredential || locationOwnedCredential)
        && connection?.health === "connected"
        && Boolean(connection?.verifiedAt);
}

export type ChatGptSubscriptionImageTextResult = ChatGptSubscriptionResult;

export type ChatGptSubscriptionConnectionStatus = {
    ok: boolean;
    provider: "chatgpt_subscription";
    transport: "codex_cli";
    model: string;
    message: string;
    details?: {
        latencyMs?: number;
        usage?: ChatGptSubscriptionUsage;
    };
};

type CodexCliRunner = (
    command: string,
    args: string[],
    options: Parameters<typeof execFile>[2]
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

type CodexCliCommand = {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    authMode: "access_token" | "isolated_auth_cache";
};

function runCodexCli(command: string, args: string[], options: Parameters<typeof execFile>[2]): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
    return new Promise((resolve, reject) => {
        const child = execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stdout, stderr }));
                return;
            }

            resolve({ stdout, stderr });
        });

        child.stdin?.end();
    });
}

export function isChatGptSubscriptionModelId(modelId: string): boolean {
    return String(modelId || "").trim().startsWith(CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX);
}

export function stripChatGptSubscriptionModelPrefix(modelId: string): string {
    const trimmed = String(modelId || "").trim();
    return trimmed.startsWith(CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX)
        ? trimmed.slice(CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX.length)
        : trimmed;
}

export function withChatGptSubscriptionModelPrefix(modelId: string): string {
    const trimmed = String(modelId || "").trim();
    if (!trimmed) return `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}${CHATGPT_SUBSCRIPTION_DEFAULT_MODEL}`;
    return trimmed.startsWith(CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX)
        ? trimmed
        : `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}${trimmed}`;
}

export function resolveChatGptSubscriptionDefaultModel(configured?: string | null): string {
    const normalized = withChatGptSubscriptionModelPrefix(configured || CHATGPT_SUBSCRIPTION_DEFAULT_MODEL);
    return CHATGPT_SUBSCRIPTION_TEXT_MODELS.some((model) => model.value === normalized)
        ? normalized
        : `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}${CHATGPT_SUBSCRIPTION_DEFAULT_MODEL}`;
}

async function resolveUserChatGptSubscriptionCredential(userId: string): Promise<ResolvedChatGptCredential | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;

    const doc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
    }).catch(() => null);
    if (
        doc?.payload?.enabled !== true
        || doc.payload.preferMyConnection !== true
        || doc.payload.credentialKind !== "managed_chatgpt"
        || doc.payload.health !== "connected"
        || !doc.payload.verifiedAt
    ) return null;

    const authCache = await settingsService.getSecret({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
    }).catch(() => null);
    if (!authCache) return null;

    return {
        fundingScope: "user_chatgpt",
        executionKey: `user:${normalizedUserId}`,
        defaultTextModel: String(doc.payload.defaultTextModel || "").trim() || null,
        authCache,
        persistAuthCache: async (nextAuthCache) => {
            const current = await settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: normalizedUserId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            });
            if (
                !current
                || current.payload?.enabled !== true
                || current.payload?.credentialKind !== "managed_chatgpt"
                || current.payload?.health !== "connected"
            ) return;
            await db.$transaction(async (tx) => {
                await settingsService.setSecret({
                    scopeType: "USER",
                    scopeId: normalizedUserId,
                    domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
                    plaintext: nextAuthCache,
                    actorUserId: normalizedUserId,
                    tx,
                });
                await settingsService.upsertDocument({
                    scopeType: "USER",
                    scopeId: normalizedUserId,
                    domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                    payload: { ...(current.payload || {}), verifiedAt: new Date().toISOString() },
                    actorUserId: normalizedUserId,
                    expectedVersion: current.version,
                    schemaVersion: 1,
                    tx,
                });
            });
        },
        markUnhealthy: async () => {
            const current = await settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: normalizedUserId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            });
            if (!current || current.payload?.enabled !== true) return;
            await settingsService.upsertDocument({
                scopeType: "USER",
                scopeId: normalizedUserId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                payload: { ...(current.payload || {}), health: "needs_attention" },
                actorUserId: normalizedUserId,
                expectedVersion: current.version,
                schemaVersion: 1,
            });
        },
    };
}

async function resolveLocationChatGptSubscriptionCredential(locationId: string): Promise<ResolvedChatGptCredential | null> {
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) return null;
    const doc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: normalizedLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
    }).catch(() => null);
    const connection = doc?.payload?.chatGptSubscription;
    if (!isEligibleLocationChatGptConnection(connection)) return null;

    const managedChatGpt = connection.credentialKind === "managed_chatgpt";
    const secretKey = managedChatGpt
        ? SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE
        : SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN;
    const credential = await settingsService.getSecret({
        scopeType: "LOCATION",
        scopeId: normalizedLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        secretKey,
    }).catch(() => null);
    if (!credential) return null;

    const updateLocationConnection = async (changes: Record<string, unknown>, nextAuthCache?: string) => {
        const current = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: normalizedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        });
        if (
            !current
            || current.payload?.chatGptSubscription?.enabled !== true
            || current.payload?.chatGptSubscription?.credentialKind !== connection.credentialKind
        ) return;
        await db.$transaction(async (tx) => {
            if (nextAuthCache) {
                await settingsService.setSecret({
                    scopeType: "LOCATION",
                    scopeId: normalizedLocationId,
                    domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
                    plaintext: nextAuthCache,
                    tx,
                });
            }
            await settingsService.upsertDocument({
                scopeType: "LOCATION",
                scopeId: normalizedLocationId,
                domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                payload: {
                    ...(current.payload || {}),
                    chatGptSubscription: {
                        ...(current.payload?.chatGptSubscription || {}),
                        ...changes,
                    },
                },
                expectedVersion: current.version,
                schemaVersion: 1,
                tx,
            });
        });
    };

    return {
        fundingScope: "location_chatgpt",
        executionKey: `location:${normalizedLocationId}`,
        accessToken: managedChatGpt ? null : credential,
        authCache: managedChatGpt ? credential : null,
        persistAuthCache: managedChatGpt
            ? async (nextAuthCache) => updateLocationConnection({ verifiedAt: new Date().toISOString() }, nextAuthCache)
            : undefined,
        markUnhealthy: async () => {
            await updateLocationConnection({ health: "needs_attention" });
        },
    };
}

export async function resolveChatGptSubscriptionCredential(
    context: ChatGptExecutionContext
): Promise<ResolvedChatGptCredential | null> {
    const interactiveUserId = context.executionMode === "interactive"
        ? String(context.userId || "").trim()
        : "";
    const normalizedLocationId = String(context.locationId || "").trim();
    if (interactiveUserId) {
        if (!normalizedLocationId) return null;
        const membership = await db.user.findFirst({
            where: { id: interactiveUserId, locations: { some: { id: normalizedLocationId } } },
            select: { id: true },
        });
        // Reject a foreign or guessed location before reading any scoped secret.
        if (!membership) return null;
    }

    const personal = interactiveUserId
        ? await resolveUserChatGptSubscriptionCredential(interactiveUserId)
        : null;
    const location = normalizedLocationId
        ? await resolveLocationChatGptSubscriptionCredential(normalizedLocationId)
        : null;
    const globalToken = context.allowEstioGlobal === true
        ? String(process.env.ESTIO_GLOBAL_CODEX_ACCESS_TOKEN || "").trim()
        : "";
    const scope = chooseChatGptFundingScope({
        executionMode: context.executionMode,
        personalAvailable: Boolean(personal),
        locationAvailable: Boolean(location),
        globalAvailable: Boolean(globalToken),
    });
    if (scope === "user_chatgpt") return personal;
    if (scope === "location_chatgpt") return location;
    if (scope === "estio_global") return { fundingScope: scope, executionKey: "estio_global", accessToken: globalToken };
    return null;
}

export async function callPreferredPersonalChatGptWithMetadata(
    systemPrompt: string,
    userContent: string | undefined,
    options: {
        executionContext: ChatGptExecutionContext;
        jsonSchema?: Record<string, unknown> | null;
        runner?: CodexCliRunner;
    }
): Promise<ChatGptSubscriptionResult | null> {
    const context = options.executionContext;
    const userId = String(context.userId || "").trim();
    const locationId = String(context.locationId || "").trim();
    if (context.executionMode !== "interactive" || !userId || !locationId || !isChatGptSubscriptionTransportEnabled()) {
        return null;
    }
    const membership = await db.user.findFirst({
        where: { id: userId, locations: { some: { id: locationId } } },
        select: { id: true },
    });
    if (!membership) return null;
    const credential = await resolveUserChatGptSubscriptionCredential(userId);
    if (!credential?.authCache) return null;

    return callChatGptSubscriptionWithMetadata(
        credential.defaultTextModel || `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}${CHATGPT_SUBSCRIPTION_DEFAULT_MODEL}`,
        systemPrompt,
        userContent,
        {
            authCache: credential.authCache,
            executionKey: credential.executionKey,
            persistAuthCache: credential.persistAuthCache,
            markUnhealthy: credential.markUnhealthy,
            jsonSchema: options.jsonSchema,
            runner: options.runner,
        }
    );
}

export async function hasChatGptSubscriptionAuth(locationId?: string): Promise<boolean> {
    if (!isChatGptSubscriptionTransportEnabled()) return false;
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) return false;
    return Boolean(await resolveLocationChatGptSubscriptionCredential(normalizedLocationId));
}

export async function getChatGptSubscriptionModelPickerState(configured?: string | null): Promise<{
    models: ChatGptSubscriptionModelOption[];
    defaultModel: string;
}> {
    return {
        models: CHATGPT_SUBSCRIPTION_TEXT_MODELS,
        defaultModel: resolveChatGptSubscriptionDefaultModel(configured),
    };
}

export function isChatGptSubscriptionImageGenerationEnabled(): boolean {
    return false;
}

export async function getChatGptSubscriptionImageModelPickerState(): Promise<{
    models: ChatGptSubscriptionModelOption[];
    defaultModel: string;
}> {
    return { models: [], defaultModel: "" };
}

export function buildCodexTextPrompt(systemPrompt: string, userContent?: string): string {
    return [
        "You are acting as a text-generation backend for Estio.",
        "Return only the final user-facing answer. Do not inspect files, run commands, edit code, or include analysis.",
        "",
        "System instructions:",
        systemPrompt,
        "",
        "User input:",
        userContent || "",
    ].join("\n");
}

export function buildCodexCliCommand(args: {
    model: string;
    prompt: string;
    outputFile: string;
    outputSchemaFile?: string | null;
    accessToken?: string | null;
    codexHome: string;
}): CodexCliCommand {
    const command = String(process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
    const model = stripChatGptSubscriptionModelPrefix(args.model) || CHATGPT_SUBSCRIPTION_DEFAULT_MODEL;
    const cwd = String(process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD || tmpdir()).trim() || tmpdir();

    const accessToken = String(args.accessToken || "").trim();
    const env = buildIsolatedCodexEnvironment({
        codexHome: args.codexHome,
        accessToken,
    });

    const commandArgs = [
        "--ask-for-approval",
        "never",
        "exec",
        "--ephemeral",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-C",
        cwd,
        "-m",
        model,
    ];
    if (args.outputSchemaFile) {
        commandArgs.push("--output-schema", args.outputSchemaFile);
    }
    commandArgs.push("--output-last-message", args.outputFile, args.prompt);

    return {
        command,
        args: commandArgs,
        env,
        authMode: accessToken ? "access_token" : "isolated_auth_cache",
    };
}

export function isChatGptSubscriptionTransportEnabled(): boolean {
    return String(process.env.CHATGPT_SUBSCRIPTION_TRANSPORT || "").trim().toLowerCase() === "codex_cli";
}

export async function callChatGptSubscriptionWithMetadata(
    modelId: string,
    systemPrompt: string,
    userContent?: string,
    options: {
        accessToken?: string | null;
        authCache?: string | null;
        executionContext?: ChatGptExecutionContext;
        executionKey?: string | null;
        persistAuthCache?: (authCache: string) => Promise<void>;
        markUnhealthy?: () => Promise<void>;
        runner?: CodexCliRunner;
        jsonSchema?: Record<string, unknown> | null;
    } = {}
): Promise<ChatGptSubscriptionResult> {
    if (!isChatGptSubscriptionTransportEnabled()) {
        throw new Error("ChatGPT subscription is currently unavailable. Ask a location admin to check the connection.");
    }

    const explicitCredential = options.accessToken || options.authCache
        ? {
            fundingScope: "user_chatgpt" as ChatGptFundingScope,
            executionKey: options.executionKey,
            accessToken: options.accessToken,
            authCache: options.authCache,
            persistAuthCache: options.persistAuthCache,
            markUnhealthy: options.markUnhealthy,
        }
        : options.executionContext
            ? await resolveChatGptSubscriptionCredential(options.executionContext)
            : null;
    if (!explicitCredential) {
        throw new Error("No authorized ChatGPT subscription connection is available for this request.");
    }
    const execute = async (credential: ResolvedChatGptCredential): Promise<ChatGptSubscriptionResult> => {
        const accessToken = String(credential.accessToken || "").trim();
        const tempDir = await mkdtemp(path.join(tmpdir(), "estio-chatgpt-subscription-"));
        const codexHome = path.join(tempDir, "codex-home");
        await mkdir(codexHome, { recursive: true, mode: 0o700 });
        if (credential.authCache) {
            await writeFile(path.join(codexHome, "auth.json"), credential.authCache, { encoding: "utf8", mode: 0o600 });
        }
        const outputFile = path.join(tempDir, "last-message.txt");
        const outputSchemaFile = options.jsonSchema ? path.join(tempDir, "output-schema.json") : null;
        const prompt = buildCodexTextPrompt(systemPrompt, userContent);
        if (outputSchemaFile) {
            await writeFile(outputSchemaFile, JSON.stringify(options.jsonSchema), "utf8");
        }
        const command = buildCodexCliCommand({
            model: modelId,
            prompt,
            outputFile,
            outputSchemaFile,
            accessToken,
            codexHome,
        });

        try {
            await (options.runner || runCodexCli)(command.command, command.args, {
                env: command.env,
                maxBuffer: 1024 * 1024 * 4,
                timeout: Number(process.env.CHATGPT_SUBSCRIPTION_CODEX_TIMEOUT_MS || 120000),
            });

            const text = (await readFile(outputFile, "utf8")).trim();
            if (!text) {
                throw new Error("ChatGPT subscription Codex transport returned an empty response.");
            }

            const promptTokens = Math.ceil(prompt.length / 4);
            const completionTokens = Math.ceil(text.length / 4);
            if (credential.authCache && credential.persistAuthCache) {
                const refreshed = await readFile(path.join(codexHome, "auth.json"), "utf8").catch(() => null);
                if (refreshed && refreshed !== credential.authCache) {
                    await credential.persistAuthCache(refreshed);
                }
            }
            return {
                text,
                model: stripChatGptSubscriptionModelPrefix(modelId),
                fundingScope: credential.fundingScope,
                usage: {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    raw: JSON.stringify({
                        source: "codex_cli_estimate",
                        promptChars: prompt.length,
                        completionChars: text.length,
                    }),
                },
            };
        } catch (error) {
            await credential.markUnhealthy?.().catch(() => undefined);
            throw new Error("The ChatGPT connection needs attention. Reconnect it or use the location provider.", { cause: error });
        } finally {
            await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    };

    if (!explicitCredential.executionKey) return execute(explicitCredential);
    return withCredentialExecutionLock(explicitCredential.executionKey, async () => {
        const freshCredential = options.executionContext
            ? await resolveChatGptSubscriptionCredential(options.executionContext)
            : explicitCredential;
        if (!freshCredential) throw new Error("No authorized ChatGPT subscription connection is available for this request.");
        return execute(freshCredential);
    });
}

export async function callChatGptSubscriptionWithImageMetadata(
    modelId: string,
    prompt: string,
    image: { base64: string; mimeType?: string | null },
    options: { accessToken?: string | null; runner?: CodexCliRunner } = {}
): Promise<ChatGptSubscriptionImageTextResult> {
    if (!isChatGptSubscriptionTransportEnabled()) {
        throw new Error("ChatGPT subscription is currently unavailable. Ask a location admin to check the connection.");
    }

    const imageBytes = Buffer.from(String(image.base64 || ""), "base64");
    if (!imageBytes.length) {
        throw new Error("Source image is empty.");
    }

    const accessToken = String(options.accessToken || "").trim();
    if (!accessToken) {
        throw new Error("ChatGPT subscription image execution requires an explicit authorized credential.");
    }
    const tempDir = await mkdtemp(path.join(tmpdir(), "estio-chatgpt-subscription-image-"));
    const imageFile = path.join(tempDir, String(image.mimeType || "").includes("png") ? "source-image.png" : "source-image.jpg");
    const outputFile = path.join(tempDir, "last-message.txt");
    const command = String(process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
    const model = stripChatGptSubscriptionModelPrefix(modelId) || CHATGPT_SUBSCRIPTION_DEFAULT_MODEL;
    const cwd = String(process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD || tempDir).trim() || tempDir;
    const env = buildIsolatedCodexEnvironment({ codexHome: tempDir, accessToken });

    try {
        await writeFile(imageFile, imageBytes);
        await (options.runner || runCodexCli)(command, [
            "--ask-for-approval",
            "never",
            "exec",
            "--ephemeral",
            "--ignore-rules",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "-C",
            cwd,
            "-m",
            model,
            "-i",
            imageFile,
            "--output-last-message",
            outputFile,
            prompt,
        ], {
            env,
            maxBuffer: 1024 * 1024 * 4,
            timeout: Number(process.env.CHATGPT_SUBSCRIPTION_CODEX_TIMEOUT_MS || 120000),
        });

        const text = (await readFile(outputFile, "utf8")).trim();
        if (!text) {
            throw new Error("ChatGPT subscription Codex image transport returned an empty response.");
        }

        const promptTokens = Math.ceil((prompt.length + imageBytes.length / 4) / 4);
        const completionTokens = Math.ceil(text.length / 4);
        return {
            text,
            model,
            fundingScope: "user_chatgpt",
            usage: {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
                raw: JSON.stringify({
                    source: "codex_cli_image_estimate",
                    promptChars: prompt.length,
                    imageBytes: imageBytes.length,
                    completionChars: text.length,
                }),
            },
        };
    } catch (error) {
        throw new Error("The ChatGPT connection could not complete this image request.", { cause: error });
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export async function validateChatGptSubscriptionConnection(options: {
    modelId?: string | null;
    accessToken?: string | null;
    runner?: CodexCliRunner;
} = {}): Promise<ChatGptSubscriptionConnectionStatus> {
    const model = resolveChatGptSubscriptionDefaultModel(options.modelId);
    const startedAt = Date.now();

    try {
        const result = await callChatGptSubscriptionWithMetadata(
            model,
            "Reply with exactly: Estio ChatGPT subscription connection ok",
            "Connection test",
            {
                accessToken: options.accessToken,
                runner: options.runner,
            }
        );

        return {
            ok: true,
            provider: "chatgpt_subscription",
            transport: "codex_cli",
            model: result.model,
            message: "ChatGPT subscription transport is connected.",
            details: {
                latencyMs: Date.now() - startedAt,
                usage: result.usage,
            },
        };
    } catch (error: any) {
        return {
            ok: false,
            provider: "chatgpt_subscription",
            transport: "codex_cli",
            model: stripChatGptSubscriptionModelPrefix(model),
            message: error?.message || "ChatGPT subscription transport test failed.",
            details: {
                latencyMs: Date.now() - startedAt,
            },
        };
    }
}
