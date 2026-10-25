import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as locationPolicy from "./active-location-policy";
import * as realmPolicy from "./auth-realm";
import * as actionPolicy from "./substo-crm-actions";
import { classifySubstoRoute } from "./host-routing-policy";
import { hasPropertyContactInput } from "./substo-crm-policy";

// Execute the actual server boundary with explicit ports; no Clerk, DB or network calls.
function load(file: string, deps: Record<string, unknown>): any {
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(`(function(require, exports, process) { ${code}\n})`, {}, { filename: file })(
    (name: string) => {
      if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`);
      return deps[name];
    }, exports, { env: { NODE_ENV: "test" } },
  );
  return exports;
}

const pages = [
  "/admin", "/admin/contacts", "/admin/contacts/estio-contact/view", "/admin/contacts/estio-contact/edit",
  "/admin/companies", "/admin/companies/estio-company/view", "/admin/projects", "/admin/conversations",
  "/admin/content/website", "/admin/content/pages/page-id/preview",
  "/admin/content/pages", "/admin/content/pages/estio-page", "/admin/content/posts", "/admin/content/posts/estio-post",
  "/admin/settings", "/admin/settings/notifications", "/admin/team", "/admin/user-profile", "/select-location",
];
const apis = [
  "/api/active-location", "/api/admin/location-session-activity", "/api/admin/conversations/estio-conversation/message-window",
  "/api/admin/conversations/translate-message", "/api/admin/conversations/translate-thread", "/api/conversations/events",
  "/api/conversations/draft-stream", "/api/conversations/summarize-stream", "/api/conversations/preview-reply-translation",
  "/api/notifications/events", "/api/notifications/subscriptions", "/api/media/attachments/estio-attachment", "/api/images/direct-upload",
];

function resolver(options: { cookie?: string; realm?: string; userRealm?: string; wrongFullRealm?: boolean; actor?: unknown } = {}) {
  const realm = options.realm ?? "substo";
  const brands = [
    { id: "substo-a", authRealm: "substo", name: "One", isPlatformMaster: false },
    { id: "substo-b", authRealm: "substo", name: "Two", isPlatformMaster: false },
    { id: "estio", authRealm: "estio", name: "Other realm", isPlatformMaster: false },
  ];
  return load("lib/auth/active-location.ts", {
    "server-only": {},
    "@clerk/nextjs/server": { auth: async () => ({ userId: "substo-clerk", actor: options.actor }) },
    "next/headers": { cookies: async () => ({ get: () => ({ value: options.cookie }) }) },
    "@/lib/auth/active-location-policy": locationPolicy,
    "@/lib/auth/impersonation-policy": { extractImpersonationClaim: () => null },
    "@/lib/auth/impersonation": { getImpersonationContextFromAuth: async () => null },
    "@/lib/auth/auth-realm": realmPolicy,
    "@/lib/auth/request-realm": { getRequestAuthRealm: async () => realm },
    "@/lib/db": { user: { findUnique: async (query: any) => {
      assert.equal(query.where.authRealm_clerkId.authRealm, realm);
      assert.equal(query.where.authRealm_clerkId.clerkId, "substo-clerk");
      assert.equal(query.select.locations.where.authRealm, realm);
      return {
        id: "substo-user", clerkId: "substo-clerk", authRealm: options.userRealm ?? realm,
        email: "same@example.com", platformRole: "USER",
        locations: brands.filter((brand) => brand.authRealm === query.select.locations.where.authRealm),
        locationRoles: brands.map((brand) => ({ locationId: brand.id, role: "ADMIN", contactAccessScope: "LOCATION_WIDE" })),
      };
    } }, location: { findUnique: async ({ where }: any) => {
      const found = brands.find((brand) => brand.id === where.id);
      return options.wrongFullRealm ? { ...found, authRealm: "estio" } : found;
    } } },
  });
}

for (const route of [...pages, ...apis]) {
  test(`${route}: foreign active-location cookie and selection cannot cross the realm`, async () => {
    assert.equal(classifySubstoRoute(route), route.startsWith("/api/") ? "crm-api" : "crm");
    const boundary = resolver({ cookie: "estio" });
    const active = await boundary.resolveActiveLocation();
    assert.equal(active.status, "selection_required");
    assert.equal(active.location, null);
    assert.deepEqual(Array.from(active.availableLocations, (row: any) => row.id), ["substo-a", "substo-b"]);
    assert.equal((await boundary.validateActiveLocationSelection("estio")).status, "no_access");
  });
}

test("valid Substo selection works; stale realm and impersonation fail closed; Estio keeps working", async () => {
  assert.equal((await resolver({ cookie: "substo-a" }).resolveActiveLocation()).location.id, "substo-a");
  assert.equal((await resolver({ cookie: "substo-a", userRealm: "estio" }).resolveActiveLocation()).status, "no_access");
  assert.equal((await resolver({ cookie: "substo-a", wrongFullRealm: true }).resolveActiveLocation()).status, "no_access");
  assert.equal((await resolver({ cookie: "substo-a", wrongFullRealm: true }).validateActiveLocationSelection("substo-a")).status, "no_access");
  assert.equal((await resolver({ cookie: "substo-a", actor: {} }).resolveActiveLocation()).status, "no_access");
  assert.equal((await resolver({ realm: "estio", cookie: "estio" }).resolveActiveLocation()).location.id, "estio");
});

test("hidden pages and API suffix/lookalike/extra segment bypasses stay closed", () => {
  for (const route of [
    "/admin/properties", "/admin/prospecting", "/admin/viewings/sessions", "/admin/live-assist", "/admin/platform",
    "/admin/settings/integrations/ghl", "/admin/settings/prospecting", "/admin/settings/location-data", "/admin/site-settings",
    "/admin/conversations/import", "/admin/content/home", "/admin/contacts-x", "/admin/contacts/x/view/extra",
    "/api/admin/conversations/property-match-campaigns/x/processing", "/api/admin/conversations/send-reply",
    "/api/admin/companies/feed-sync", "/api/admin/properties/upsert", "/api/google/auth", "/api/cron/task-sync",
    "/api/webhooks/ghl", "/api/viewings/sessions/quick-start", "/api/admin/debug-sync", "/api/test/seed",
  ]) assert.equal(classifySubstoRoute(route), "blocked", route);
  for (const route of apis.filter((value) => !value.includes("estio-"))) {
    for (const suffix of [".json", "-malicious", "/extra"]) assert.equal(classifySubstoRoute(route + suffix), "blocked", route + suffix);
  }
});

test("forbidden Server Actions fail before tenant resolution, even when posted to an allowed page", async () => {
  let realm = "substo";
  let resolved = 0;
  let tenantRealm = "substo";
  const guard = load("lib/auth/crm-action-guard.ts", {
    "server-only": {}, "./request-realm": { getRequestAuthRealm: async () => realm },
    "./substo-crm-actions": actionPolicy, "./substo-crm-policy": { hasPropertyContactInput },
    "./active-location": { resolveActiveLocation: async () => { resolved++; return { status: "authorized", location: { authRealm: tenantRealm } }; } },
  });
  for (const [module, action] of [
    ["properties/actions.ts", "upsertProperty"], ["team/actions.ts", "inviteUser"], ["companies/actions.ts", "addFeed"],
    ["conversations/actions.ts", "createPropertyMatchCampaignAction"], ["conversations/actions.ts", "suggestViewingsFromSelection"],
    ["conversations/actions.ts", "sendReply"], ["conversations/actions.ts", "getTraceTreeAction"], ["new/actions.ts", "newAction"],
  ]) await assert.rejects(guard.assertCrmActionAllowed(module, action), /unavailable/);
  assert.equal(resolved, 0);
  await guard.assertCrmActionAllowed("contacts/actions.ts", "createContact");
  assert.equal(resolved, 1);
  tenantRealm = "estio";
  await assert.rejects(guard.assertCrmActionAllowed("contacts/actions.ts", "createContact"), /Unauthorized/);
  realm = "estio";
  await guard.assertCrmActionAllowed("properties/actions.ts", "upsertProperty");
});

test("property operations embedded in contact writes are rejected while generic fields work", () => {
  assert.equal(hasPropertyContactInput({ roleType: "property", entityId: "estio-property" }), true);
  assert.equal(hasPropertyContactInput({ propertiesMatched: ["estio-property"] }), true);
  assert.equal(hasPropertyContactInput({ propertiesInterested: '["estio-property"]' }), true);
  assert.equal(hasPropertyContactInput({ matchingPropertiesToMatch: "all" }), true);
  assert.equal(hasPropertyContactInput({ roleType: "company", entityId: "company", name: "Contact", propertiesInterested: [] }), false);
});

function filesIn(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(file) : /\.(ts|tsx)$/.test(file) && !file.includes(".test.") ? [file] : [];
  });
}

test("every non-Studio/brand Server Action export starts with the app firewall", () => {
  let count = 0;
  for (const file of [...filesIn("app"), ...filesIn("lib")]) {
    const text = fs.readFileSync(file, "utf8");
    if (!/^['"]use server['"]/.test(text) || file.includes("/studio/") || file.includes("/brand/")) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.body || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const first = statement.body.statements[0].getText(source);
      // Safe read used by existing contact pages: Substo reports no Outlook connection.
      if (statement.name?.text === "getOutlookStatusAction") assert.match(first, /getRequestAuthRealm.*substo.*connected: false/);
      else assert.match(first, /^await assertCrmActionAllowed\(/, `${file}:${statement.name?.text}`);
      count++;
    }
  }
  assert.ok(count >= 413);
});

test("foreign media IDs return 404 before redirecting or signing storage URLs", async () => {
  const route = load("app/api/media/attachments/[attachmentId]/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init), redirect: () => { throw new Error("foreign media redirect"); } } },
    "@/lib/db": { messageAttachment: { findUnique: async () => ({ url: "r2://private/estio", message: { conversation: { locationId: "estio" } } }) } },
    "@/lib/auth/location-context": { getLocationContext: async () => ({ id: "substo-a" }) },
    "@/lib/whatsapp/media-r2": { createWhatsAppMediaReadUrl: () => { throw new Error("foreign storage signing"); }, parseR2Uri: () => { throw new Error("foreign storage parsing"); } },
  });
  const result = await route.GET({ nextUrl: new URL("https://substo.com/api/media/attachments/estio") }, { params: Promise.resolve({ attachmentId: "estio" }) });
  assert.equal(result.status, 404);
});

test("foreign conversation IDs stop at the scoped message-window query before cache or message access", async () => {
  const forbidden = () => { throw new Error("foreign data or cache read"); };
  const route = load("app/api/admin/conversations/[conversationId]/message-window/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth/location-context": { getLocationContext: async () => ({ id: "substo-a" }) },
    "@/lib/feature-flags": { getConversationFeatureFlags: forbidden },
    "@/lib/observability/performance": { createTraceId: () => "test-trace" },
    "@/lib/conversations/message-window-loading": { loadConversationMessageWindow: forbidden },
    "@/lib/conversations/workspace-metadata-loading": { getCachedConversationWorkspaceCoreMetadata: forbidden, queryConversationWorkspaceCoreMetadata: forbidden },
    "@/lib/contacts/active-location-access": { getActiveContactsAccess: async () => ({ locationId: "substo-a" }) },
    "@/lib/conversations/contact-assignment-access": { buildConversationVisibilityWhere: (access: any) => ({ locationId: access.locationId }) },
    "@/lib/conversations/identity": { buildConversationReferenceWhere: (locationId: string, id: string) => ({ locationId, id }) },
    "@/lib/db": { conversation: { findFirst: async ({ where }: any) => {
      for (const clause of where.AND) assert.equal(clause.locationId, "substo-a");
      return null;
    } } },
  });
  const result = await route.GET({ url: "https://substo.com/api/admin/conversations/estio/message-window" }, { params: { conversationId: "estio" } });
  assert.equal(result.status, 404);
});

test("push subscription ownership is included in the atomic unique write", async () => {
  let write: any;
  const service = load("lib/notifications/server.ts", {
    "@/lib/db": { webPushSubscription: { upsert: async (query: any) => { write = query; return {}; } } },
    "@prisma/client": { Prisma: { JsonNull: null } }, "@clerk/nextjs/server": {},
    "@/lib/notifications/runtime-config": {}, "@/lib/notifications/task-deadline-state": {},
    "@/lib/tasks/reminder-config": {}, "@/lib/tasks/reminders": {}, "@/lib/contacts/active-location-access": {}, "@/lib/notifications/location-scope": {},
  });
  await service.upsertWebPushSubscriptionForUser({ userId: "substo-user", endpoint: "estio-endpoint", p256dh: "key", auth: "key" });
  assert.equal(write.where.endpoint, "estio-endpoint");
  assert.equal(write.where.userId, "substo-user");
});
