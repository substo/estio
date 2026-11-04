import assert from "node:assert/strict";
import test from "node:test";
import { experienceFor, pageRoute } from "./experience";

test("screens come from page routes and read as the user sees them", () => {
  assert.equal(pageRoute("app/(main)/admin/conversations/page.tsx"), "/admin/conversations");
  assert.equal(pageRoute("app/(main)/admin/conversations/layout.tsx"), null);
  assert.equal(pageRoute("app/page.tsx"), "/");
  assert.deepEqual(experienceFor("app/(main)/admin/settings/integrations/whatsapp/page.tsx"), { route: "/admin/settings/integrations/whatsapp", section: "CRM", area: "Settings", product: "crm", name: "Settings › Integrations › WhatsApp" });
  assert.equal(experienceFor("app/(main)/admin/conversations/[id]/page.tsx")?.name, "Conversations › Detail");
  assert.equal(experienceFor("app/(main)/admin/platform/build/page.tsx")?.section, "Platform admin");
  assert.equal(experienceFor("app/studio/knowledge/page.tsx")?.product, "studio");
  assert.equal(experienceFor("app/[domain]/property/[slug]/page.tsx")?.section, "Public website");
  assert.equal(experienceFor("app/[domain]/[page]/page.tsx")?.area, "Pages");
  assert.equal(experienceFor("app/sign-in/[[...sign-in]]/page.tsx")?.name, "Sign In");
});
