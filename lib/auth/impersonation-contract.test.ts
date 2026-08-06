import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("actor tokens are created only in the server service with bounded lifetime and an audit", () => {
  const service = read("lib/auth/impersonation.ts");
  assert.match(service, /import "server-only"/);
  assert.match(service, /impersonationAudit\.create[\s\S]+actorTokens\.create/);
  assert.match(service, /expiresInSeconds: ACTOR_TOKEN_TTL_SECONDS/);
  assert.match(service, /sessionMaxDurationInSeconds: IMPERSONATION_SESSION_MAX_SECONDS/);
  assert.match(service, /additionalProperties: \{ auditId: audit\.id, locationId:/);
});

test("master login requires platform role, Clerk identity agreement, and both membership records", () => {
  const service = read("lib/auth/impersonation.ts");
  assert.match(service, /platformRole !== "PLATFORM_ADMIN"/);
  assert.ok((service.match(/identitiesAgree\(/g) || []).length >= 2);
  assert.match(service, /target\.locations\.length !== 1 \|\| target\.locationRoles\.length !== 1/);
  assert.match(service, /audit\.target\.locations\.length !== 1/);
});

test("the audited location overrides cookies and invalid actor sessions fail closed", () => {
  const resolver = read("lib/auth/active-location.ts");
  assert.match(resolver, /impersonation\?\.locationId \?\?/);
  assert.match(resolver, /authState\.actor && !impersonation/);
});

test("server and client detect actor state, show a banner, and provide an exit", () => {
  const resolver = read("lib/auth/active-location.ts");
  const banner = read("app/(main)/admin/_components/impersonation-banner.tsx");
  const layout = read("app/(main)/admin/layout.tsx");
  assert.match(resolver, /authState\.actor/);
  assert.match(layout, /activateCurrentImpersonation/);
  assert.match(banner, /useAuth\(\)/);
  assert.match(banner, /Logged in as/);
  assert.match(banner, /\/api\/platform\/impersonation\/end/);
});

test("Clerk owns one-time ticket consumption for actor-token sign in", () => {
  const signInPage = read("app/(main)/(auth)/sign-in/[[...sign-in]]/page.tsx");
  assert.match(signInPage, /<SignIn \/>/);
  assert.doesNotMatch(signInPage, /useSignIn|strategy: "ticket"|__clerk_ticket|signIn\.create/);
});

test("master login is direct, does not require a support reason, and allows normal user actions", () => {
  const service = read("lib/auth/impersonation.ts");
  const form = read("app/(main)/admin/_components/platform-location-login-switcher.tsx");
  const middleware = read("middleware.ts");
  assert.match(service, /MASTER_LOGIN_AUDIT_REASON = "Master user login"/);
  assert.match(service, /IMPERSONATION_SESSION_MAX_SECONDS = 8 \* 60 \* 60/);
  assert.doesNotMatch(service, /normalizeSupportReason/);
  assert.match(form, /window\.location\.assign\(result\.launchUrl\)/);
  assert.match(form, /Log in as user/);
  assert.doesNotMatch(form, /Textarea|reason|clipboard|one-time support link/i);
  assert.doesNotMatch(middleware, /isRestrictedImpersonationRequest/);
});
