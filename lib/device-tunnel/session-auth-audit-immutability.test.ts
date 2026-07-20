import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("session-auth audit events remain append-only at the database boundary", async () => {
    const migration = await readFile(
        "prisma/migrations/20260720120000_whatsapp_session_auth_placement/migration.sql",
        "utf8",
    );

    assert.match(migration, /CREATE OR REPLACE FUNCTION "prevent_whatsapp_session_auth_audit_mutation"/i);
    assert.match(migration, /BEFORE UPDATE OR DELETE ON "WhatsAppSessionAuthAuditEvent"/i);
    assert.match(migration, /RAISE EXCEPTION 'WhatsApp session-auth audit events are append-only'/i);
});
