import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { profileSpec, selectProfile, validLease, canRevoke, sameOrigin, type JobSpec } from "./contract";
import { reverseAffected } from "./scanner";

test("Build uses the platform gate: location admin, Substo and impersonation cannot acquire operator context", async () => {
  for (const option of [{ role: "ADMIN", realm: "estio", actor: null }, { role: "PLATFORM_ADMIN", realm: "substo", actor: null }, { role: "PLATFORM_ADMIN", realm: "estio", actor: {} }, { role: "PLATFORM_ADMIN", realm: "estio", actor: null }]) {
    const module = { exports: {} as { getPlatformAdminContext: () => Promise<unknown> } };
    const deps: Record<string, unknown> = { "server-only": {}, react: { cache: (fn: unknown) => fn }, "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk", actor: option.actor }) }, "@/lib/auth/request-realm": { getRequestAuthRealm: async () => option.realm }, "@/lib/auth/auth-realm": { isBusinessRealm: () => true, realmClerkIdWhere: () => ({}) }, "@/lib/db": { default: { user: { findUnique: async () => ({ id: "admin", clerkId: "clerk", authRealm: option.realm, platformRole: option.role }) } } } };
    const code = ts.transpileModule(fs.readFileSync("lib/auth/platform-access.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => deps[name] });
    assert.equal(Boolean(await module.exports.getPlatformAdminContext()), option.role === "PLATFORM_ADMIN" && option.realm === "estio" && !option.actor);
  }
  assert.equal(sameOrigin(new Request("https://estio.co/api/build", { headers: { origin: "https://evil.test" } })), false);
  assert.equal(sameOrigin(new Request("https://estio.co/api/build")), false);
  assert.equal(sameOrigin(new Request("https://estio.co/api/build", { headers: { origin: "https://estio.co" } })), true);
  assert.equal(sameOrigin(new Request("http://localhost:3000/api/build", { headers: { origin: "https://estio.co", "x-forwarded-host": "estio.co", "x-forwarded-proto": "https" } })), true);
});
test("fallback needs stopped writer, approved quality/tools and a different exhausted quota bucket", () => {
  const base = profileSpec.parse({ id: "primary", enabled: true, provider: "codex", account: "default", billing: "subscription", model: "gpt-6.1-sol", options: {}, quotaBucket: "a", taskTypes: ["review"], tools: ["git-read"], dataScope: "estio-repository", quality: 2, concurrency: 1, maxAttempts: 2, fallbacks: ["same", "low", "safe"] });
  const profiles = [base, { ...base, id: "same" }, { ...base, id: "low", quotaBucket: "b", quality: 1 }, { ...base, id: "safe", quotaBucket: "c" }];
  const job = { profileId: "primary", taskType: "review", quality: 2, tools: ["git-read"] } as JobSpec;
  assert.equal(selectProfile(profiles, job, { previous: base, exhaustedBuckets: ["a"] }), null);
  assert.equal(selectProfile(profiles, job, { previous: base, stopped: true, exhaustedBuckets: ["a"] })?.id, "safe");
  assert.equal(selectProfile(profiles, { ...job, tools: ["code-write"] }, { previous: base, stopped: true }), null);
});
test("leases reject expiry, duplicate completion, wrong worker and token; old dependency edges retain consumers", () => {
  assert.equal(canRevoke("blocked-lease-expired"), false);
  assert.equal(canRevoke("stopping"), false);
  assert.equal(canRevoke("working"), true);
  const job = { state: "working", leaseToken: "token", workerId: "mac", leaseUntil: new Date(2000) };
  assert.equal(validLease(job, "token", "mac", new Date(1000)), true);
  for (const [state, token, worker, time] of [["working", "wrong", "mac", 1000], ["working", "token", "other", 1000], ["working", "token", "mac", 2000], ["review", "token", "mac", 1000]] as const)
    assert.equal(validLease({ ...job, state }, token, worker, new Date(time)), false);
  assert.deepEqual([...reverseAffected(["shared"], [{ fromId: "old", toId: "shared" }, { fromId: "new", toId: "shared" }, { fromId: "journey", toId: "old" }])].sort(), ["journey", "new", "old", "shared"]);
});

test("routing uses exactly the job's difficulty and only approved, enabled profiles", () => {
  const p = (id: string, quality: number, bucket: string, enabled = true) => profileSpec.parse({ id, enabled, provider: "claudeAgent", account: "default", billing: "subscription", model: id, options: {}, quotaBucket: bucket, taskTypes: ["inspect", "implementation", "review"], tools: ["git-read", "code-write"], dataScope: "estio-repository", quality, concurrency: 1, maxAttempts: 2, fallbacks: [] });
  const profiles = [p("sonnet", 2, "claude"), p("opus", 3, "claude"), p("sol", 3, "codex"), p("off", 3, "x", false)];
  const job = { profileId: "none", taskType: "implementation", quality: 3, tools: ["git-read", "code-write"] } as JobSpec;
  assert.equal(selectProfile(profiles, job)?.id, "opus");
  assert.equal(selectProfile(profiles, { ...job, quality: 2 })?.id, "sonnet");
  assert.equal(selectProfile(profiles, job, { exhaustedBuckets: ["claude"] })?.id, "sol");
  assert.equal(selectProfile(profiles, job, { previous: profiles[1], stopped: true })?.id, "sol");
  assert.equal(selectProfile(profiles, job, { exhaustedBuckets: ["claude", "codex"] }), null);
  assert.throws(() => profileSpec.parse({ ...profiles[0], options: { effort: "ultrathink" } }));
});

test("the system assesses difficulty and falls back to any approved level", async () => {
  const { assessDifficulty } = await import("./contract");
  const impl = { taskType: "implementation" as const, scope: ["app/page.tsx"], acceptance: ["works"] };
  assert.equal(assessDifficulty(impl, 3).quality, 2);
  assert.match(assessDifficulty({ ...impl, scope: ["prisma/schema.prisma"] }, 0).routing, /Hard: touches prisma/);
  assert.equal(assessDifficulty({ ...impl, scope: ["a", "b", "c", "d", "e"] }, 0).quality, 3);
  assert.equal(assessDifficulty(impl, 40).quality, 3);
  assert.equal(assessDifficulty({ ...impl, taskType: "review", scope: ["prisma/x", "b"] }, 40).quality, 2);
  const routineOnly = profileSpec.parse({ id: "sonnet", enabled: true, provider: "claudeAgent", account: "default", billing: "subscription", model: "sonnet", options: {}, quotaBucket: "claude", taskTypes: ["implementation"], tools: ["git-read", "code-write"], dataScope: "estio-repository", quality: 2, concurrency: 1, maxAttempts: 2, fallbacks: [] });
  assert.equal(selectProfile([routineOnly], { profileId: "auto", taskType: "implementation", quality: 3, tools: ["git-read", "code-write"] } as JobSpec)?.id, "sonnet");
});

test("review proposals are extracted from the last json block, validated and capped", async () => {
  const { extractProposals } = await import("./contract");
  const good = { title: "Shorten reply box", outcome: "Reply box fits mobile", reason: "Overflows at 390px", scope: ["app/x/page.tsx"], acceptance: ["No horizontal scroll at 390px"] };
  const text = "Findings...\n```json\n{\"proposals\":[]}\n```\nFinal:\n```json\n" + JSON.stringify({ proposals: [good, { title: "x" }, good, good, good] }) + "\n```";
  const r = extractProposals(text);
  assert.equal(r.proposals.length, 3); assert.equal(r.dropped, 2);
  assert.deepEqual(extractProposals("no block"), { proposals: [], dropped: 0 });
  assert.deepEqual(extractProposals("```json\n{not json}\n```"), { proposals: [], dropped: 0 });
  assert.equal(extractProposals("```json\n{\"proposals\":[]}\n```").proposals.length, 0);
});

test("auto-approval policy admits only small Routine implementation outside sensitive areas", async () => {
  const { autoApprovable } = await import("./contract");
  const spec = { taskType: "implementation", quality: 2, scope: ["app/(main)/admin/contacts/page.tsx"], acceptance: ["a"] } as JobSpec;
  assert.deepEqual(autoApprovable(spec), { ok: true, reasons: [] });
  assert.match(autoApprovable({ ...spec, quality: 3 }).reasons.join(), /Hard/);
  assert.match(autoApprovable({ ...spec, scope: ["a", "b", "c", "d"] }).reasons.join(), /more than 3 files/);
  assert.match(autoApprovable({ ...spec, scope: ["prisma/schema.prisma"] }).reasons.join(), /touches prisma/);
  assert.match(autoApprovable({ ...spec, taskType: "review" }).reasons.join(), /only implementation/);
});

test("screen drafts ride in the review json block and are validated", async () => {
  const { extractScreen } = await import("./contract");
  const block = { proposals: [], screen: { purpose: "Read and answer client messages", journey: "Open a thread, read, reply", features: [{ name: "AI draft reply", purpose: "Suggests a reply" }] } };
  const d = extractScreen("Review...\n```json\n" + JSON.stringify(block) + "\n```");
  assert.equal(d?.purpose, "Read and answer client messages"); assert.equal(d?.features[0].journey, "");
  assert.equal(extractScreen("```json\n{\"proposals\":[]}\n```"), null);
  assert.equal(extractScreen("```json\n{\"screen\":{\"purpose\":\"x\"}}\n```"), null);
});
