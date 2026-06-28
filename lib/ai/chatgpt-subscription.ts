import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { resolveAuthenticatedDbUserId } from "@/lib/auth/current-user";

const execFileAsync = promisify(execFile);

export const CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX = "chatgpt_subscription:";
export const CHATGPT_SUBSCRIPTION_DEFAULT_MODEL = "gpt-5.4-mini";

export type ChatGptSubscriptionModelOption = {
    value: string;
    label: string;
    description?: string;
};

export const CHATGPT_SUBSCRIPTION_TEXT_MODELS: ChatGptSubscriptionModelOption[] = [
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
    {
        value: `${CHATGPT_SUBSCRIPTION_MODEL_VALUE_PREFIX}gpt-5.4-mini`,
        label: "ChatGPT Subscription GPT-5.4 Mini",
        description: "Lower-usage Codex/ChatGPT subscription-backed text agent model",
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
};

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

export type ChatGptSubscriptionSetupGuide = {
    transportEnabled: boolean;
    codexCliPath: string;
    codexCwd: string;
    transportEnvVar: string;
    requiredTransportValue: string;
    deviceAuthCommand: string;
    statusCommand: string;
    accessTokenCommand: string;
    notes: string[];
};

type ExecFileRunner = typeof execFileAsync;

type CodexCliCommand = {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    authMode: "access_token" | "codex_login_cache";
};

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

async function resolveUserChatGptSubscriptionAccessToken(userId: string): Promise<string | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;

    const doc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
    }).catch(() => null);
    if (doc?.payload?.enabled !== true) return null;

    return await settingsService.getSecret({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
    }).catch(() => null);
}

export async function resolveChatGptSubscriptionAccessToken(): Promise<string | null> {
    const userId = await resolveAuthenticatedDbUserId();
    if (userId) {
        const userToken = await resolveUserChatGptSubscriptionAccessToken(userId);
        if (userToken) return userToken;
    }

    return String(process.env.CODEX_ACCESS_TOKEN || "").trim() || null;
}

export async function hasChatGptSubscriptionAuth(): Promise<boolean> {
    return Boolean(await resolveChatGptSubscriptionAccessToken()) || isChatGptSubscriptionTransportEnabled();
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
    accessToken?: string | null;
}): CodexCliCommand {
    const command = String(process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
    const model = stripChatGptSubscriptionModelPrefix(args.model) || CHATGPT_SUBSCRIPTION_DEFAULT_MODEL;
    const cwd = String(process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD || tmpdir()).trim() || tmpdir();

    const accessToken = String(args.accessToken || "").trim();
    const env = { ...process.env };
    if (accessToken) {
        env.CODEX_ACCESS_TOKEN = accessToken;
    } else {
        delete env.CODEX_ACCESS_TOKEN;
    }

    return {
        command,
        args: [
            "exec",
            "--ephemeral",
            "--ignore-rules",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--ask-for-approval",
            "never",
            "-C",
            cwd,
            "-m",
            model,
            "--output-last-message",
            args.outputFile,
            args.prompt,
        ],
        env,
        authMode: accessToken ? "access_token" : "codex_login_cache",
    };
}

export function isChatGptSubscriptionTransportEnabled(): boolean {
    return String(process.env.CHATGPT_SUBSCRIPTION_TRANSPORT || "").trim().toLowerCase() === "codex_cli";
}

export function getChatGptSubscriptionSetupGuide(): ChatGptSubscriptionSetupGuide {
    const codexCliPath = String(process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
    const codexCwd = String(process.env.CHATGPT_SUBSCRIPTION_CODEX_CWD || tmpdir()).trim() || tmpdir();

    return {
        transportEnabled: isChatGptSubscriptionTransportEnabled(),
        codexCliPath,
        codexCwd,
        transportEnvVar: "CHATGPT_SUBSCRIPTION_TRANSPORT",
        requiredTransportValue: "codex_cli",
        deviceAuthCommand: `${codexCliPath} login --device-auth`,
        statusCommand: `${codexCliPath} login status`,
        accessTokenCommand: `printf '%s' "$CODEX_ACCESS_TOKEN" | ${codexCliPath} login --with-access-token`,
        notes: [
            "Run device auth on the trusted server or runner that will execute subscription-backed text generation.",
            "Set CHATGPT_SUBSCRIPTION_TRANSPORT=codex_cli before starting the Estio app process.",
            "If the runner has a valid Codex login cache, Estio can use that cache without a separate access token.",
            "For non-interactive deployments, create a Codex access token in a supported ChatGPT workspace and store it as CODEX_ACCESS_TOKEN or as the encrypted per-user token in this profile.",
            "After setup, use Test Subscription to run a real tiny Codex request through the same runtime path.",
        ],
    };
}

export async function callChatGptSubscriptionWithMetadata(
    modelId: string,
    systemPrompt: string,
    userContent?: string,
    options: { accessToken?: string | null; runner?: ExecFileRunner } = {}
): Promise<ChatGptSubscriptionResult> {
    if (!isChatGptSubscriptionTransportEnabled()) {
        throw new Error("ChatGPT subscription transport is disabled. Set CHATGPT_SUBSCRIPTION_TRANSPORT=codex_cli on a trusted server with Codex CLI installed.");
    }

    const accessToken = String(options.accessToken || await resolveChatGptSubscriptionAccessToken() || "").trim();
    const tempDir = await mkdtemp(path.join(tmpdir(), "estio-chatgpt-subscription-"));
    const outputFile = path.join(tempDir, "last-message.txt");
    const prompt = buildCodexTextPrompt(systemPrompt, userContent);
    const command = buildCodexCliCommand({
        model: modelId,
        prompt,
        outputFile,
        accessToken,
    });

    try {
        await (options.runner || execFileAsync)(command.command, command.args, {
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
        return {
            text,
            model: stripChatGptSubscriptionModelPrefix(modelId),
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
    } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export async function validateChatGptSubscriptionConnection(options: {
    modelId?: string | null;
    accessToken?: string | null;
    runner?: ExecFileRunner;
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
