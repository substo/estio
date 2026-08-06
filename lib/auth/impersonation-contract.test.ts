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

test("support access requires platform role, Clerk identity agreement, and both membership records", () => {
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
  const middleware = read("middleware.ts");
  const banner = read("app/(main)/admin/_components/impersonation-banner.tsx");
  assert.match(middleware, /authState\.actor/);
  assert.match(banner, /useAuth\(\)/);
  assert.match(banner, /Viewing as/);
  assert.match(banner, /\/api\/platform\/impersonation\/end/);
});
