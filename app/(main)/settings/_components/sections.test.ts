import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { classifySubstoRoute } from "@/lib/auth/host-routing-policy";
import { visibleSettingsSections } from "./sections";

const locationRoutesInBothApps = ["general", "ai", "computer", "team", "notifications"];
const estioSections = ["integrations", "conversations", "contacts", "live-assist", "property-media", "prospecting", "media", "location-data"];
const integrationPages = [
  "google", "microsoft", "sms-relay", "provider-sync", "ghl", "old-crm", "gemini", "openai-api",
  "chatgpt-subscription", "whatsapp", "whatsapp/linked-phone", "whatsapp/meta", "whatsapp/twilio",
];

const pageExists = (path: string) => existsSync(new URL(`../..${path}/page.tsx`, import.meta.url));
const menu = (...args: Parameters<typeof visibleSettingsSections>) => visibleSettingsSections(...args).map(section => section.href);

test("shared Settings and retained integrations agree with their realm-specific menu and route policies", () => {
  const estio = menu("estio", "ADMIN", false);
  const substo = menu("substo", "ADMIN", false);
  for (const section of locationRoutesInBothApps) {
    const route = `/settings/${section}`;
    assert.ok(estio.includes(route) && substo.includes(route), route);
    assert.equal(classifySubstoRoute(route), "settings", route);
    assert.ok(pageExists(route), route);
  }
  for (const section of estioSections) {
    const route = `/settings/${section}`;
    assert.ok(estio.includes(route) && !substo.includes(route), route);
    assert.equal(classifySubstoRoute(route), "blocked", route);
    assert.ok(pageExists(route), route);
  }
  for (const section of integrationPages) {
    const route = `/settings/integrations/${section}`;
    assert.ok(pageExists(route), route);
    assert.equal(classifySubstoRoute(route), "blocked", route);
  }
  for (const section of ["appearance", "navigation"]) {
    const route = `/admin/content/website/${section}`;
    assert.ok(pageExists(route), route);
    assert.equal(classifySubstoRoute(route), "crm", route);
    assert.ok(!estio.includes(route) && !substo.includes(route), route);
  }
});

test("personal connections are in Settings independently of the selected Location or role", () => {
  const route = "/account/connections";
  assert.ok(pageExists(route));
  assert.equal(classifySubstoRoute(route), "profile");
  for (const realm of ["estio", "substo"] as const) {
    for (const role of ["ADMIN", "MEMBER", null] as const) {
      assert.ok(menu(realm, role, false).includes(route));
    }
    assert.deepEqual(menu(realm, null, false), [route]);
  }
  assert.ok(!menu("estio", "ADMIN", true).includes(route));
  assert.ok(!menu("estio", "ADMIN", false, true).includes(route));
  for (const section of ["team", "contacts", "conversations", "live-assist", "property-media", "media", "location-data"]) {
    assert.ok(!menu("estio", "MEMBER", false).includes(`/settings/${section}`), section);
  }
});
