import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260801130000_deal_assigned_user/migration.sql");
const deals = read("app/(main)/admin/deals/actions.ts");
const conversations = read("app/(main)/admin/conversations/actions.ts");

test("Deal assignment is a nullable User relation with conservative exact backfill", () => {
    assert.match(schema, /model DealContext[\s\S]*assignedUserId\s+String\?[\s\S]*DealAssignedUser/);
    assert.match(migration, /COUNT\(DISTINCT contact\."assignedUserId"\) = 1/);
    assert.match(migration, /"DealConversationLink"/);
    assert.doesNotMatch(migration, /INSERT INTO "DealContext"|UPDATE "Message"|UPDATE "ContactHistory"/);
});

test("Deal UI reads and mutations use server-derived assignment policy", () => {
    assert.match(deals, /getDealContexts\(scope[\s\S]{0,700}buildDealVisibilityWhere\(access, scope\)/);
    for (const name of ["queryDealParticipants", "updateDealStatus", "runDealAgentAction", "removeConversationFromDeal", "fetchDealTimeline"]) {
        const start = deals.indexOf(`${name}(`);
        assert.notEqual(start, -1);
        assert.match(deals.slice(start, start + 6500), /buildDealManageWhere\(access\)/, `${name} must enforce Deal assignment`);
    }
    assert.match(deals, /assignedUserId: access\.internalUserId/);
    assert.match(conversations, /createDealContext[\s\S]{0,5000}assignedUserId: access\.internalUserId/);
});
