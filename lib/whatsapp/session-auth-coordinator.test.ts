import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { WhatsAppSessionAuthCoordinator } from "./session-auth-coordinator";
import { getLocalAuthProfilePath } from "./session-auth-profile";

const ownership = {
    locationId: "location-1",
    sessionId: "session-1",
    bindingId: "binding-1",
    gatewayNodeId: "node-1",
    assignmentEpoch: 2,
    ownerInstanceId: "owner-1",
    leaseEpoch: 3,
};

function placement() {
    return {
        id: "placement-1",
        locationId: ownership.locationId,
        sessionId: ownership.sessionId,
        bindingId: ownership.bindingId,
        currentGeneration: 0,
        authEpoch: 1,
        operationId: "operation-1",
    };
}

function coordinator(dataPath: string, options: { discardLocalProfile?: boolean } = {}) {
    const calls = { completed: 0, failed: 0 };
    const store = {
        claimAttach: async () => ({
            placement: placement(),
            alreadyAttached: false,
            discardLocalProfile: options.discardLocalProfile === true,
        }),
        completeAttach: async (claimed: any) => {
            calls.completed += 1;
            return { ...claimed, state: "attached" };
        },
        failOperation: async (claimed: any) => {
            calls.failed += 1;
            return claimed;
        },
    };
    return {
        calls,
        value: new WhatsAppSessionAuthCoordinator({
            store: store as any,
            objectStore: {} as any,
            keyWrapper: {} as any,
            kmsKeyName: "projects/project-1/locations/global/keyRings/ring-1/cryptoKeys/key-1",
            dataPath,
        }),
    };
}

test("generation-zero attach preserves a complete quiescent local profile for initial checkpoint", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wa-auth-adopt-"));
    try {
        const profilePath = getLocalAuthProfilePath(root, "bridge_session_1");
        await mkdir(path.join(profilePath, "Default", "IndexedDB"), { recursive: true });
        await mkdir(path.join(profilePath, "Default", "Local Storage"), { recursive: true });
        const marker = path.join(profilePath, "Default", "IndexedDB", "auth.db");
        await writeFile(marker, "existing-auth");
        const { value, calls } = coordinator(root);

        const attached = await value.attach({ ownership, bridgeSessionId: "bridge_session_1" });

        assert.equal(attached.durableReady, false);
        assert.equal(await readFile(marker, "utf8"), "existing-auth");
        assert.deepEqual(calls, { completed: 1, failed: 0 });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("generation-zero attach leaves a genuinely new session empty for QR linking", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wa-auth-new-"));
    try {
        const profilePath = getLocalAuthProfilePath(root, "bridge_session_1");
        const { value, calls } = coordinator(root);

        const attached = await value.attach({ ownership, bridgeSessionId: "bridge_session_1" });

        assert.equal(attached.durableReady, false);
        await assert.rejects(access(profilePath));
        assert.deepEqual(calls, { completed: 1, failed: 0 });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("relink-required attach deletes a complete stale local login before starting", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wa-auth-relink-"));
    try {
        const profilePath = getLocalAuthProfilePath(root, "bridge_session_1");
        await mkdir(path.join(profilePath, "Default", "IndexedDB"), { recursive: true });
        await mkdir(path.join(profilePath, "Default", "Local Storage"), { recursive: true });
        const marker = path.join(profilePath, "Default", "IndexedDB", "auth.db");
        await writeFile(marker, "stale-auth");
        const { value, calls } = coordinator(root, { discardLocalProfile: true });

        const attached = await value.attach({ ownership, bridgeSessionId: "bridge_session_1" });

        assert.equal(attached.durableReady, false);
        await assert.rejects(access(marker));
        assert.deepEqual(calls, { completed: 1, failed: 0 });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test("generation-zero attach rejects but preserves an incomplete existing profile", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wa-auth-invalid-"));
    try {
        const profilePath = getLocalAuthProfilePath(root, "bridge_session_1");
        const marker = path.join(profilePath, "Default", "marker.txt");
        await mkdir(path.dirname(marker), { recursive: true });
        await writeFile(marker, "do-not-delete");
        const { value, calls } = coordinator(root);

        await assert.rejects(
            value.attach({ ownership, bridgeSessionId: "bridge_session_1" }),
            (error: any) => error?.code === "SESSION_AUTH_LOCAL_PROFILE_INVALID",
        );

        assert.equal(await readFile(marker, "utf8"), "do-not-delete");
        assert.deepEqual(calls, { completed: 0, failed: 1 });
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
