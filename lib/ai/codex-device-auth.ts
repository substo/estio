import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation, verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import { buildIsolatedCodexEnvironment } from "@/lib/ai/codex-environment";

export type CodexConnectionScope = "USER" | "LOCATION";
export type CodexDeviceAuthState = "waiting" | "connected" | "expired" | "cancelled" | "failed";

export type SafeCodexDeviceAttempt = {
    attemptId: string;
    scope: CodexConnectionScope;
    state: CodexDeviceAuthState;
    verificationUrl?: string;
    userCode?: string;
    expiresAt: string;
    message?: string;
};

export type SafeChatGptUsageLimits = {
    primary: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null;
    secondary: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null;
};

type Attempt = SafeCodexDeviceAttempt & {
    actorClerkUserId: string;
    actorUserId: string;
    locationId: string;
    scopeId: string;
    loginId?: string;
    process: ChildProcessWithoutNullStreams;
    homeDir: string;
    handled: boolean;
    timeout: NodeJS.Timeout;
    rateLimitTimeout?: NodeJS.Timeout;
    pendingAccount?: any;
};

const ATTEMPT_TTL_MS = 10 * 60 * 1000;
const TERMINAL_RESULT_RETENTION_MS = 60 * 1000;
const registry = new Map<string, Attempt>();

function settingsScope(attempt: Pick<Attempt, "scope" | "scopeId">) {
    return attempt.scope === "USER"
        ? { scopeType: "USER" as const, scopeId: attempt.scopeId, domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS }
        : { scopeType: "LOCATION" as const, scopeId: attempt.scopeId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS };
}

async function setPendingAttemptMarker(input: {
    attemptId: string;
    scope: CodexConnectionScope;
    scopeId: string;
    actorUserId: string;
}) {
    const scope = settingsScope(input as Pick<Attempt, "scope" | "scopeId">);
    const existing = await settingsService.getDocument<any>(scope).catch(() => null);
    await settingsService.upsertDocument({
        ...scope,
        payload: { ...(existing?.payload || {}), pendingDeviceAttemptId: input.attemptId },
        actorUserId: input.actorUserId,
        expectedVersion: existing?.version ?? 0,
        schemaVersion: 1,
    });
}

async function clearPendingAttemptMarker(attempt: Attempt) {
    const scope = settingsScope(attempt);
    const existing = await settingsService.getDocument<any>(scope).catch(() => null);
    if (!existing || existing.payload?.pendingDeviceAttemptId !== attempt.attemptId) return;
    await settingsService.upsertDocument({
        ...scope,
        payload: { ...(existing.payload || {}), pendingDeviceAttemptId: null },
        actorUserId: attempt.actorUserId,
        expectedVersion: existing.version,
        schemaVersion: 1,
    }).catch(() => undefined);
}

export function maskChatGptIdentity(email?: string | null): string | null {
    const normalized = String(email || "").trim();
    const at = normalized.indexOf("@");
    if (at < 1) return normalized ? "Connected account" : null;
    const local = normalized.slice(0, at);
    return `${local.slice(0, 1)}***@${normalized.slice(at + 1)}`;
}

export function matchesCodexAttemptOwner(
    owner: { actorUserId: string; locationId: string; scope: CodexConnectionScope },
    request: { actorUserId: string; locationId: string; scope: CodexConnectionScope }
): boolean {
    return owner.actorUserId === request.actorUserId
        && owner.locationId === request.locationId
        && owner.scope === request.scope;
}

export function isCodexDeviceAttemptTerminal(state: CodexDeviceAuthState): boolean {
    return state !== "waiting";
}

export function canConsumeCodexDeviceAttempt(input: {
    state: CodexDeviceAuthState;
    handled: boolean;
    expiresAt: string;
    now?: number;
}): boolean {
    const expiresAt = Date.parse(input.expiresAt);
    return input.state === "waiting"
        && !input.handled
        && Number.isFinite(expiresAt)
        && expiresAt > (input.now ?? Date.now());
}

function canCancelAttempt(attempt: Attempt): boolean {
    return canConsumeCodexDeviceAttempt(attempt);
}

function safeLimitWindow(value: any) {
    const usedPercent = Number(value?.usedPercent);
    if (!Number.isFinite(usedPercent)) return null;
    const windowDurationMins = Number(value?.windowDurationMins);
    const resetsAt = Number(value?.resetsAt);
    return {
        usedPercent: Math.max(0, Math.min(100, usedPercent)),
        windowDurationMins: Number.isFinite(windowDurationMins) ? Math.max(0, windowDurationMins) : null,
        resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    };
}

export function sanitizeChatGptUsageLimits(value: any): SafeChatGptUsageLimits | null {
    const primary = safeLimitWindow(value?.primary);
    const secondary = safeLimitWindow(value?.secondary);
    return primary || secondary ? { primary, secondary } : null;
}

function safe(attempt: Attempt): SafeCodexDeviceAttempt {
    return {
        attemptId: attempt.attemptId,
        scope: attempt.scope,
        state: attempt.state,
        verificationUrl: attempt.verificationUrl,
        userCode: attempt.userCode,
        expiresAt: attempt.expiresAt,
        message: attempt.message,
    };
}

function send(attempt: Attempt, message: unknown) {
    if (!attempt.process.killed) attempt.process.stdin.write(`${JSON.stringify(message)}\n`);
}

async function cleanup(attempt: Attempt) {
    clearTimeout(attempt.timeout);
    if (attempt.rateLimitTimeout) clearTimeout(attempt.rateLimitTimeout);
    delete attempt.userCode;
    if (!attempt.process.killed) attempt.process.kill("SIGTERM");
    await clearPendingAttemptMarker(attempt);
    await rm(attempt.homeDir, { recursive: true, force: true }).catch(() => undefined);
    setTimeout(() => {
        delete attempt.pendingAccount;
        registry.delete(attempt.attemptId);
    }, TERMINAL_RESULT_RETENTION_MS);
}

async function isStillAuthorized(attempt: Attempt): Promise<boolean> {
    const user = await db.user.findUnique({
        where: { clerkId: attempt.actorClerkUserId },
        select: { id: true },
    });
    if (!user || user.id !== attempt.actorUserId) return false;
    if (!await verifyUserHasAccessToLocation(attempt.actorClerkUserId, attempt.locationId)) return false;
    if (attempt.scope === "LOCATION") {
        return verifyUserIsLocationAdmin(attempt.actorClerkUserId, attempt.locationId);
    }
    return attempt.scopeId === user.id;
}

async function completeLogin(attempt: Attempt, account: any, usageLimits: SafeChatGptUsageLimits | null = null) {
    if (!canConsumeCodexDeviceAttempt(attempt)) return;
    attempt.handled = true;
    if (!await isStillAuthorized(attempt)) {
        attempt.state = "failed";
        attempt.message = "Your access changed before sign-in completed. Start again.";
        await cleanup(attempt);
        return;
    }

    const authCache = await readFile(path.join(attempt.homeDir, "auth.json"), "utf8").catch(() => null);
    if (!authCache) {
        attempt.state = "failed";
        attempt.message = "ChatGPT signed in, but Codex did not provide a credential store that Estio can save safely.";
        await cleanup(attempt);
        return;
    }

    const scope = settingsScope(attempt);
    const existing = await settingsService.getDocument<any>(scope).catch(() => null);
    if (!existing || existing.payload?.pendingDeviceAttemptId !== attempt.attemptId) {
        attempt.state = "cancelled";
        attempt.message = "This sign-in was superseded or disconnected. Start again if needed.";
        await cleanup(attempt);
        return;
    }
    try {
        await db.$transaction(async (tx) => {
            await settingsService.setSecret({
                ...scope,
                secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
                plaintext: authCache,
                actorUserId: attempt.actorUserId,
                tx,
            });
            await settingsService.upsertDocument({
                ...scope,
                payload: attempt.scope === "LOCATION" ? {
                    ...(existing.payload || {}),
                    pendingDeviceAttemptId: null,
                    chatGptSubscription: {
                        ...(existing.payload?.chatGptSubscription || {}),
                        enabled: true,
                        credentialKind: "managed_chatgpt",
                        eligibility: "location_owned_subscription",
                        identityMasked: maskChatGptIdentity(account?.email),
                        planType: String(account?.planType || "").trim() || null,
                        verifiedAt: new Date().toISOString(),
                        health: "connected",
                        usageLimits,
                    },
                } : {
                    ...(existing.payload || {}),
                    pendingDeviceAttemptId: null,
                    enabled: true,
                    preferMyConnection: existing.payload?.preferMyConnection === true,
                    credentialKind: "managed_chatgpt",
                    emailMasked: maskChatGptIdentity(account?.email),
                    planType: String(account?.planType || "").trim() || null,
                    verifiedAt: new Date().toISOString(),
                    health: "connected",
                    usageLimits,
                },
                actorUserId: attempt.actorUserId,
                expectedVersion: existing.version,
                schemaVersion: 1,
                tx,
            });
        });
    } catch {
        attempt.state = "cancelled";
        attempt.message = "This sign-in was superseded or disconnected. Start again if needed.";
        await cleanup(attempt);
        return;
    }
    attempt.state = "connected";
    attempt.message = attempt.scope === "LOCATION"
        ? "The ChatGPT subscription is connected for this location."
        : "Your ChatGPT subscription is connected.";
    delete attempt.userCode;
    await cleanup(attempt);
}

function handleMessage(attempt: Attempt, message: any) {
    if (message?.id === 2 && message?.result?.type === "chatgptDeviceCode") {
        attempt.loginId = String(message.result.loginId || "");
        attempt.verificationUrl = String(message.result.verificationUrl || "");
        attempt.userCode = String(message.result.userCode || "");
        return;
    }
    if (message?.method === "account/login/completed" && message?.params?.loginId === attempt.loginId) {
        if (message.params.success === true) send(attempt, { method: "account/read", id: 3, params: { refreshToken: false } });
        else {
            attempt.handled = true;
            attempt.state = "failed";
            attempt.message = "ChatGPT sign-in did not complete. Start again.";
            void cleanup(attempt);
        }
        return;
    }
    if (message?.id === 3 && message?.result?.account) {
        attempt.pendingAccount = message.result.account;
        send(attempt, { method: "account/rateLimits/read", id: 4, params: {} });
        attempt.rateLimitTimeout = setTimeout(() => {
            void completeLogin(attempt, attempt.pendingAccount, null);
        }, 2000);
        return;
    }
    if (message?.id === 4 && attempt.pendingAccount) {
        const usageLimits = sanitizeChatGptUsageLimits(message?.result?.rateLimits);
        void completeLogin(attempt, attempt.pendingAccount, usageLimits);
    }
}

export async function startCodexDeviceAuth(input: {
    actorClerkUserId: string;
    actorUserId: string;
    locationId: string;
    scope: CodexConnectionScope;
}): Promise<SafeCodexDeviceAttempt> {
    const previousAttempts = [...registry.values()].filter((attempt) =>
        matchesCodexAttemptOwner(attempt, {
            actorUserId: input.actorUserId,
            locationId: input.locationId,
            scope: input.scope,
        }) && canCancelAttempt(attempt)
    );
    await Promise.all(previousAttempts.map((attempt) =>
        cancelCodexDeviceAuth(attempt.attemptId, input.actorUserId, input.locationId, input.scope)
    ));

    const attemptId = randomUUID();
    const scopeId = input.scope === "USER" ? input.actorUserId : input.locationId;
    const homeDir = await mkdtemp(path.join(tmpdir(), "estio-codex-auth-"));
    await mkdir(homeDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(homeDir, "config.toml"), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
    try {
        await setPendingAttemptMarker({
            attemptId,
            scope: input.scope,
            scopeId,
            actorUserId: input.actorUserId,
        });
    } catch (error) {
        await rm(homeDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
    const command = String(process.env.CODEX_CLI_PATH || "codex").trim() || "codex";
    const child = spawn(command, ["app-server"], {
        env: buildIsolatedCodexEnvironment({ codexHome: homeDir }),
        stdio: ["pipe", "pipe", "pipe"],
    });
    const expiresAt = new Date(Date.now() + ATTEMPT_TTL_MS).toISOString();
    const attempt: Attempt = {
        attemptId,
        scope: input.scope,
        state: "waiting" as const,
        expiresAt,
        actorClerkUserId: input.actorClerkUserId,
        actorUserId: input.actorUserId,
        locationId: input.locationId,
        scopeId,
        process: child,
        homeDir,
        handled: false,
        timeout: setTimeout(() => undefined, ATTEMPT_TTL_MS),
    };
    clearTimeout(attempt.timeout);
    attempt.timeout = setTimeout(() => {
        if (attempt.handled) return;
        attempt.handled = true;
        attempt.state = "expired";
        attempt.message = "The one-time code expired. Start again.";
        void cleanup(attempt);
    }, ATTEMPT_TTL_MS);
    registry.set(attemptId, attempt);

    const lines = readline.createInterface({ input: child.stdout });
    child.stderr.resume();
    lines.on("line", (line) => {
        try { handleMessage(attempt, JSON.parse(line)); } catch { /* never expose provider output */ }
    });
    child.once("error", () => {
        if (attempt.handled) return;
        attempt.handled = true;
        attempt.state = "failed";
        attempt.message = "ChatGPT sign-in is unavailable on this server.";
        void cleanup(attempt);
    });
    child.once("exit", () => {
        if (attempt.handled) return;
        attempt.handled = true;
        attempt.state = "failed";
        attempt.message = "ChatGPT sign-in stopped before it completed.";
        void cleanup(attempt);
    });

    send(attempt, { method: "initialize", id: 1, params: { clientInfo: { name: "estio", title: "Estio", version: "1.0.0" } } });
    send(attempt, { method: "initialized", params: {} });
    send(attempt, { method: "account/login/start", id: 2, params: { type: "chatgptDeviceCode" } });
    return safe(attempt);
}

export function readCodexDeviceAuth(attemptId: string, actorUserId: string, locationId: string, scope: CodexConnectionScope): SafeCodexDeviceAttempt | null {
    const attempt = registry.get(String(attemptId || ""));
    if (!attempt || !matchesCodexAttemptOwner(attempt, { actorUserId, locationId, scope })) return null;
    if (!isCodexDeviceAttemptTerminal(attempt.state) && Date.parse(attempt.expiresAt) <= Date.now()) {
        attempt.handled = true;
        attempt.state = "expired";
        attempt.message = "The one-time code expired. Start again.";
        void cleanup(attempt);
    }
    return safe(attempt);
}

export async function cancelCodexDeviceAuth(attemptId: string, actorUserId: string, locationId: string, scope: CodexConnectionScope): Promise<boolean> {
    const attempt = registry.get(String(attemptId || ""));
    if (!attempt || !matchesCodexAttemptOwner(attempt, { actorUserId, locationId, scope })) return false;
    if (!canCancelAttempt(attempt)) return false;
    attempt.handled = true;
    attempt.state = "cancelled";
    attempt.message = "ChatGPT sign-in was cancelled.";
    delete attempt.pendingAccount;
    if (attempt.loginId) send(attempt, { method: "account/login/cancel", id: 5, params: { loginId: attempt.loginId } });
    await cleanup(attempt);
    return true;
}

export async function cancelCodexDeviceAuthForOwner(input: {
    actorUserId: string;
    locationId: string;
    scope: CodexConnectionScope;
}): Promise<void> {
    const attempts = [...registry.values()].filter((attempt) =>
        matchesCodexAttemptOwner(attempt, input) && canCancelAttempt(attempt)
    );
    await Promise.all(attempts.map((attempt) =>
        cancelCodexDeviceAuth(attempt.attemptId, input.actorUserId, input.locationId, input.scope)
    ));
}

export async function disconnectCodexConnection(input: {
    actorUserId: string;
    locationId: string;
    scope: CodexConnectionScope;
}): Promise<void> {
    await cancelCodexDeviceAuthForOwner(input);
    const scopeId = input.scope === "USER" ? input.actorUserId : input.locationId;
    const scope = settingsScope({ scope: input.scope, scopeId } as Pick<Attempt, "scope" | "scopeId">);
    await db.$transaction(async (tx) => {
        const existing = await tx.settingsDocument.findUnique({
            where: {
                scopeType_scopeId_domain: {
                    scopeType: scope.scopeType,
                    scopeId: scope.scopeId,
                    domain: scope.domain,
                },
            },
        });
        await settingsService.clearSecret({
            ...scope,
            secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
            actorUserId: input.actorUserId,
            tx,
        });
        if (input.scope === "LOCATION") {
            await settingsService.clearSecret({
                ...scope,
                secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                actorUserId: input.actorUserId,
                tx,
            });
        }
        const existingPayload = existing?.payload && typeof existing.payload === "object" && !Array.isArray(existing.payload)
            ? existing.payload as Record<string, any>
            : {};
        const payload = input.scope === "USER"
            ? {
                ...existingPayload,
                pendingDeviceAttemptId: null,
                enabled: false,
                preferMyConnection: false,
                credentialKind: null,
                emailMasked: null,
                planType: null,
                verifiedAt: null,
                health: "disconnected",
                usageLimits: null,
            }
            : {
                ...existingPayload,
                pendingDeviceAttemptId: null,
                chatGptSubscription: {
                    ...(existingPayload.chatGptSubscription || {}),
                    enabled: false,
                    credentialKind: null,
                    eligibility: null,
                    identityMasked: null,
                    planType: null,
                    verifiedAt: null,
                    health: "disconnected",
                    usageLimits: null,
                },
            };
        await settingsService.upsertDocument({
            ...scope,
            payload,
            actorUserId: input.actorUserId,
            expectedVersion: existing?.version ?? 0,
            schemaVersion: 1,
            tx,
        });
    });
}
