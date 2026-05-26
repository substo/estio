import assert from "node:assert/strict";
import test from "node:test";
import { buildWebBridgeDiagnostics } from "./web-bridge-diagnostics";

const expectedSessionDir = "/home/martin/whatsapp-web-sessions";

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
