export type WhatsAppWebBridgeOperationalStatus =
    | "healthy"
    | "worker_unreachable"
    | "stale_worker"
    | "app_webhook_failed"
    | "qr_required"
    | "unlinked"
    | "starting"
    | "failed"
    | "disconnected";

export type WhatsAppWebBridgeDiagnostics = {
    reachable: boolean;
    ok: boolean;
    severity: "healthy" | "warning" | "error";
    status: WhatsAppWebBridgeOperationalStatus;
    message: string;
    baseUrl: string;
    uptimeSeconds: number | null;
    sessionCount: number | null;
    sessionDir: string | null;
    expectedSessionDir: string | null;
    sessionDirMatchesExpected: boolean | null;
    maxInlineMediaBytes: number | null;
    protocolTimeoutMs: number | null;
    dbStatus: string;
    workerStatus: string | null;
    workerSessionPresent: boolean;
    workerReady: boolean;
    stale: boolean;
    workerLastEventAt: string | null;
    workerLastReadyAt: string | null;
    workerLastWebhookSuccessAt: string | null;
    workerLastWebhookErrorAt: string | null;
    workerLastError: string | null;
    workerLastErrorActive: boolean;
    error: string | null;
};

function normalizeSessionStatus(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function parseTimestampMs(value: unknown) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : null;
}

export function buildWebBridgeDiagnostics(args: {
    session: any;
    health: any;
    expectedSessionDir?: string | null;
}): WhatsAppWebBridgeDiagnostics {
    const session = args.session;
    const health = args.health;
    const sessionId = session?.sessionId ? String(session.sessionId) : "";
    const workerSession = sessionId && Array.isArray(health?.sessions)
        ? health.sessions.find((item: any) => String(item.sessionId || "") === sessionId)
        : null;
    const dbStatus = normalizeSessionStatus(session?.status || "not_created");
    const workerStatus = workerSession?.status ? normalizeSessionStatus(workerSession.status) : (workerSession?.ready ? "ready" : null);
    const dbReady = dbStatus === "ready";
    const workerReady = Boolean(workerSession?.ready);
    const reachable = Boolean(health?.reachable);
    const stale = dbReady && (!reachable || !workerReady);
    const workerLastWebhookSuccessAt = workerSession?.lastWebhookSuccessAt || null;
    const workerLastWebhookErrorAt = workerSession?.lastWebhookErrorAt || null;
    const workerLastWebhookSuccessMs = parseTimestampMs(workerLastWebhookSuccessAt);
    const workerLastWebhookErrorMs = parseTimestampMs(workerLastWebhookErrorAt);
    const workerLastError = workerSession?.lastError || null;
    const workerLastErrorLooksLikeWebhookFailure = /^App webhook failed\b/i.test(String(workerLastError || ""));
    const workerLastErrorActive = Boolean(workerLastError && (workerLastWebhookErrorMs || workerLastErrorLooksLikeWebhookFailure) && (
        !workerLastWebhookSuccessMs
        || !workerLastWebhookErrorMs
        || workerLastWebhookErrorMs >= workerLastWebhookSuccessMs
    ));
    const expectedSessionDir = args.expectedSessionDir || null;
    const sessionDir = health?.sessionDir || null;
    const sessionDirMatchesExpected = expectedSessionDir && sessionDir
        ? String(expectedSessionDir) === String(sessionDir)
        : null;

    let severity: "healthy" | "warning" | "error" = "healthy";
    let status: WhatsAppWebBridgeOperationalStatus = "healthy";
    let message = "WhatsApp Web Bridge is reachable and ready.";

    if (!reachable) {
        severity = "error";
        status = "worker_unreachable";
        message = health?.error || "WhatsApp Web Bridge worker is not reachable.";
    } else if (sessionDirMatchesExpected === false) {
        severity = "error";
        status = "worker_unreachable";
        message = `Bridge worker is using ${sessionDir}, expected ${expectedSessionDir}. Restart the worker with the persistent session directory.`;
    } else if (stale) {
        severity = "warning";
        status = "stale_worker";
        message = "Database session says ready, but the worker does not have a matching ready session. Restart the worker or session.";
    } else if (workerReady && workerLastErrorActive) {
        severity = "warning";
        status = "app_webhook_failed";
        message = workerLastError || "Bridge worker is ready, but app webhook ingestion has an active failure.";
    } else if (workerStatus === "qr" || dbStatus === "qr") {
        severity = "warning";
        status = "qr_required";
        message = "QR code is waiting to be scanned.";
    } else if (workerStatus === "disconnected" || dbStatus === "disconnected" || dbStatus === "not_created") {
        severity = "warning";
        status = "unlinked";
        message = "Bridge session is not linked. Start the session and scan the QR code.";
    } else if (workerStatus === "failed" || dbStatus === "failed") {
        severity = "error";
        status = "failed";
        message = session?.lastError || workerSession?.lastError || "Bridge session is failed. Clear or restart the session.";
    } else if (workerStatus === "authenticated" || workerStatus === "starting" || dbStatus === "authenticated" || dbStatus === "starting") {
        severity = "warning";
        status = "starting";
        message = "Bridge session is starting. Refresh status shortly.";
    } else if (!workerReady) {
        severity = "warning";
        status = "starting";
        message = "Bridge worker is reachable, but no session is ready yet.";
    }

    return {
        reachable,
        ok: Boolean(health?.ok),
        severity,
        status,
        message,
        baseUrl: health?.baseUrl || "http://127.0.0.1:3218",
        uptimeSeconds: health?.uptimeSeconds ?? null,
        sessionCount: health?.sessionCount ?? null,
        sessionDir,
        expectedSessionDir,
        sessionDirMatchesExpected,
        maxInlineMediaBytes: health?.maxInlineMediaBytes ?? null,
        protocolTimeoutMs: health?.protocolTimeoutMs ?? null,
        dbStatus,
        workerStatus,
        workerSessionPresent: Boolean(workerSession),
        workerReady,
        stale,
        workerLastEventAt: workerSession?.lastEventAt || null,
        workerLastReadyAt: workerSession?.lastReadyAt || null,
        workerLastWebhookSuccessAt,
        workerLastWebhookErrorAt,
        workerLastError,
        workerLastErrorActive,
        error: health?.error || null,
    };
}
