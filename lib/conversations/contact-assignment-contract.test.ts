import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const actions = read("app/(main)/admin/conversations/actions.ts");
const page = read("app/(main)/admin/conversations/page.tsx");
const list = read("lib/conversations/conversation-list-loading.ts");
const eventsRoute = read("app/api/conversations/events/route.ts");
const messageWindowRoute = read("app/api/admin/conversations/[conversationId]/message-window/route.ts");
const sendRoute = read("app/api/admin/conversations/send-reply/route.ts");

test("conversation list, pagination, delta, and search apply Contact assignment", () => {
    assert.match(list, /buildConversationStatusWhere[\s\S]*contact:\s*\{ is:\s*\{ locationId, assignedUserId \}/);
    assert.match(list, /queryConversationListDelta[\s\S]*assignedUserId[\s\S]*contact:\s*\{ is:/);
    assert.match(actions, /fetchConversations[\s\S]{0,2500}getAuthenticatedConversationContext\(options\?\.scope\)/);
    assert.match(actions, /searchConversations[\s\S]{0,10000}assignedUserId[\s\S]*hydrateRankedConversationRows/);
});

test("thread, message, send, and lifecycle guessed IDs use the inherited policy", () => {
    assert.match(actions, /buildAuthorizedConversationReferenceWhere[\s\S]{0,700}buildConversationVisibilityWhere/);
    for (const name of ["fetchMessages", "getConversationWorkspaceCore", "sendReply", "deleteConversations", "archiveConversations"]) {
        const start = actions.indexOf(`export async function ${name}`);
        assert.notEqual(start, -1, `${name} must exist`);
        assert.match(actions.slice(start, start + 7000), /(buildAuthorizedConversationReferenceWhere|buildConversationVisibilityWhere)/, `${name} must authorize through Contact`);
    }
    assert.match(messageWindowRoute, /buildConversationVisibilityWhere\(access, "location"\)/);
    assert.match(sendRoute, /getActiveContactsAccess/);
});

test("realtime events are filtered before replay or live delivery to MEMBER", () => {
    assert.match(eventsRoute, /eventIsVisible/);
    assert.match(eventsRoute, /buildConversationVisibilityWhere\(access, "location"\)/);
    assert.match(eventsRoute, /if \(!\(await eventIsVisible\(parsed\)\)\) return/);
    assert.match(eventsRoute, /if \(!\(await eventIsVisible\(event\)\)\) continue/);
    assert.doesNotMatch(eventsRoute, /sendEvent\("conversation", \{ raw: rawMessage \}\)/);
});

test("scope selector follows approved Contact visibility while server authorization resolves requested scope", () => {
    assert.match(page, /canViewLocationContacts\(access\)/);
    assert.match(page, /My assignments/);
    assert.match(page, /All location/);
    assert.match(page, /resolveConversationScope\(access, requestedScope\)/);
});
