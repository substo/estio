import assert from "node:assert/strict";
import test from "node:test";
import {
    buildWebBridgeDiagnostics,
    findMatchingWhatsAppWebBridgeHealthSession,
} from "./web-bridge-diagnostics";
import { fingerprintOperationalPath, redactOperationalIdentifier } from "../device-tunnel/operational-redaction";

const expectedSessionDir = "/home/martin/whatsapp-web-sessions";

test("matches redacted health references without exposing raw tenant identifiers", () => {
    const sessionId = "estio_loc_1";
    const locationId = "loc_1";
    const expected = {
        sessionRef: redactOperationalIdentifier(sessionId, "session"),
        locationRef: redactOperationalIdentifier(locationId, "location"),
        status: "ready",
        ready: true,
    };
    assert.equal(findMatchingWhatsAppWebBridgeHealthSession({
        sessions: [expected],
        sessionId,
        locationId,
    }), expected);
});

test("does not match another tenant or bridge session", () => {
    const worker = {
        sessionRef: redactOperationalIdentifier("estio_loc_other", "session"),
        locationRef: redactOperationalIdentifier("loc_other", "location"),
        status: "ready",
        ready: true,
    };
    assert.equal(findMatchingWhatsAppWebBridgeHealthSession({
        sessions: [worker],
        sessionId: "estio_loc_1",
        locationId: "loc_1",
    }), null);
    assert.equal(findMatchingWhatsAppWebBridgeHealthSession({
        sessions: [{
            ...worker,
            locationRef: redactOperationalIdentifier("loc_1", "location"),
        }],
        sessionId: "estio_loc_1",
        locationId: "loc_1",
    }), null);
});

test("classifies a matching ready worker session as healthy", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "ready" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [{ sessionId: "estio_loc_1", status: "ready", ready: true }],
        },
    });

    assert.equal(diagnostics.status, "healthy");
    assert.equal(diagnostics.severity, "healthy");
    assert.equal(diagnostics.workerReady, true);
});

test("classifies ready worker with active app webhook failure as warning", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "ready" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [{
                sessionId: "estio_loc_1",
                status: "ready",
                ready: true,
                lastError: "App webhook failed 400: malformed json",
                lastWebhookErrorAt: "2026-05-29T09:01:00.000Z",
                lastWebhookSuccessAt: "2026-05-29T09:00:00.000Z",
            }],
        },
    });

    assert.equal(diagnostics.status, "app_webhook_failed");
    assert.equal(diagnostics.severity, "warning");
    assert.equal(diagnostics.workerLastErrorActive, true);
});

test("classifies stale app webhook failure as healthy after newer success", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "ready" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [{
                sessionId: "estio_loc_1",
                status: "ready",
                ready: true,
                lastError: "App webhook failed 400: malformed json",
                lastWebhookErrorAt: "2026-05-29T09:00:00.000Z",
                lastWebhookSuccessAt: "2026-05-29T09:01:00.000Z",
            }],
        },
    });

    assert.equal(diagnostics.status, "healthy");
    assert.equal(diagnostics.severity, "healthy");
    assert.equal(diagnostics.workerLastErrorActive, false);
});

test("does not classify non-webhook worker errors as app webhook failures", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "ready" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [{
                sessionId: "estio_loc_1",
                status: "ready",
                ready: true,
                lastError: "WhatsApp Web watchdog failed.",
            }],
        },
    });

    assert.equal(diagnostics.status, "healthy");
    assert.equal(diagnostics.workerLastErrorActive, false);
});

test("classifies db-ready but worker-missing state as stale", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "ready" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [],
        },
    });

    assert.equal(diagnostics.status, "stale_worker");
    assert.equal(diagnostics.severity, "warning");
    assert.equal(diagnostics.stale, true);
});

test("authoritative local disconnect remains unlinked when the worker is unreachable", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "disconnected" },
        health: {
            reachable: false,
            ok: false,
            error: "WhatsApp Web Bridge health check timed out.",
            sessions: [],
        },
    });

    assert.equal(diagnostics.status, "unlinked");
    assert.equal(diagnostics.severity, "warning");
    assert.equal(diagnostics.workerReady, false);
});

test("classifies qr worker status as relink required", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "qr" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [{ sessionId: "estio_loc_1", status: "qr", ready: false }],
        },
    });

    assert.equal(diagnostics.status, "qr_required");
    assert.equal(diagnostics.severity, "warning");
});

test("classifies stale authenticated worker as stale instead of indefinitely starting", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        nowMs: Date.parse("2026-05-29T06:04:00.000Z"),
        session: { sessionId: "estio_loc_1", status: "authenticated" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: expectedSessionDir,
            sessions: [{
                sessionId: "estio_loc_1",
                status: "authenticated",
                ready: false,
                lastEventAt: "2026-05-29T06:00:00.000Z",
            }],
        },
    });

    assert.equal(diagnostics.status, "stale_worker");
    assert.equal(diagnostics.severity, "warning");
    assert.match(diagnostics.message, /stayed authenticated/i);
});

test("classifies wrong session dir as an error", () => {
    const diagnostics = buildWebBridgeDiagnostics({
        expectedSessionDir,
        session: { sessionId: "estio_loc_1", status: "ready" },
        health: {
            reachable: true,
            ok: true,
            sessionDir: "/home/martin/estio-app/.data/whatsapp-web-sessions",
            sessions: [{ sessionId: "estio_loc_1", status: "ready", ready: true }],
        },
    });

    assert.equal(diagnostics.status, "worker_unreachable");
    assert.equal(diagnostics.severity, "error");
    assert.equal(diagnostics.sessionDirMatchesExpected, false);
});

test("matches redacted worker references and path fingerprints without exposing the path", () => {
    const session = { sessionId: "estio_loc_1", locationId: "loc_1", status: "ready" };
    const expectedSessionDir = "/private/secret/whatsapp-profile";
    const diagnostics = buildWebBridgeDiagnostics({
        session,
        expectedSessionDir,
        health: {
            reachable: true,
            ok: true,
            sessionDirFingerprint: fingerprintOperationalPath(expectedSessionDir),
            sessions: [{
                sessionRef: redactOperationalIdentifier(session.sessionId, "session"),
                locationRef: redactOperationalIdentifier(session.locationId, "location"),
                status: "ready",
                ready: true,
            }],
        },
    });
    assert.equal(diagnostics.workerSessionPresent, true);
    assert.equal(diagnostics.workerReady, true);
    assert.equal(diagnostics.sessionDirMatchesExpected, true);
    assert.equal(diagnostics.sessionDir, null);
    assert.equal(JSON.stringify(diagnostics).includes(expectedSessionDir), false);
});
