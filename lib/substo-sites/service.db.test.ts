import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getPublishedWebsite, getWebsitePage, getWebsitePost, listWebsitePages, listWebsitePosts, saveWebsiteSettings as saveSettings, saveWebsiteDesign as saveDesign, type WebsiteActor } from "./service";
import { applyDetailsPatch } from "@/lib/business-profile/patch";
import { businessProfileSchema } from "@/lib/business-profile/schema";
import type { BusinessDetailsPatch } from "@/lib/business-profile/view";
import { websiteLayoutOnly } from "@/lib/website/settings";
const url = process.env.LOCATIONS_TEST_DATABASE_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || new URL(url).pathname !== "/estio_user_auth_realm_test") throw new Error("Use bash scripts/test-user-auth-realm-db.sh with its disposable local database");
const db = new PrismaClient({ datasourceUrl: url });
after(() => db.$disconnect());
let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence}`;
async function brand(realm: "estio" | "substo" = "substo", role: "ADMIN" | "MEMBER" = "ADMIN") {
  const user = await db.user.create({ data: { email: `${unique("website")}@example.com`, clerkId: unique("site-clerk"), authRealm: realm } });
  const location = await db.location.create({ data: { name: "Private internal brand name", authRealm: realm, users: { connect: { id: user.id } } } });
  await db.userLocationRole.create({ data: { userId: user.id, locationId: location.id, role } });
  return { userId: user.id, locationId: location.id, role };
}
// Savers writing through this disposable database (the app's savers use the shared settings service).
async function upsertDoc(locationId: string, domain: string, payload: Record<string, unknown>) {
  const where = { scopeType_scopeId_domain: { scopeType: "LOCATION" as const, scopeId: locationId, domain } };
  await db.settingsDocument.upsert({ where, create: { scopeType: "LOCATION", scopeId: locationId, domain, payload: payload as any }, update: { payload: payload as any, version: { increment: 1 } } });
}
const docPayload = async (locationId: string, domain: string) => ((await db.settingsDocument.findUnique({ where: { scopeType_scopeId_domain: { scopeType: "LOCATION", scopeId: locationId, domain } } }))?.payload ?? null) as Record<string, any> | null;
const saveLayout = async (locationId: string, patch: Record<string, unknown>) => upsertDoc(locationId, "location.public_site", websiteLayoutOnly({ ...(await docPayload(locationId, "location.public_site")), ...patch }));
const saveBusiness = async (locationId: string, patch: BusinessDetailsPatch, actorUserId: string) => {
  const current = await docPayload(locationId, "location.business");
  await upsertDoc(locationId, "location.business", applyDetailsPatch(current ? businessProfileSchema.parse(current) : null, patch, actorUserId) as Record<string, unknown>);
};
const saveWebsiteSettings = (database: typeof db, actor: WebsiteActor, value: Parameters<typeof saveSettings>[2]) => saveSettings(database, actor, value, saveBusiness, saveLayout);
const saveWebsiteDesign = (database: typeof db, actor: WebsiteActor, form: FormData) => saveDesign(database, actor, form, saveBusiness, saveLayout);
const input = (slug: string) => ({ slug, published: true, settings: { title: "Public brand", description: "Public description", googleAiApiKey: "NOT-PUBLIC", logoUrl: "javascript:alert(1)" } });

test("a new brand has no website address and is unpublished", async () => {
  const actor = await brand("estio");
  const location = await db.location.findUniqueOrThrow({ where: { id: actor.locationId } });
  assert.equal(location.websitePublished, false);
  assert.equal(location.websiteSlug, null);
});

test("public reader rejects Estio and unpublished brands and projects only explicit public fields", async () => {
  const estio = await brand("estio");
  const estioSlug = unique("estio");
  await db.location.update({ where: { id: estio.locationId }, data: { websiteSlug: estioSlug, websitePublished: true } });
  assert.equal(await getPublishedWebsite(db, estioSlug), null);
  const actor = await brand();
  const slug = unique("public");
  await saveWebsiteSettings(db, actor, { ...input(slug), published: false });
  assert.equal(await getPublishedWebsite(db, slug), null);
  await saveWebsiteSettings(db, actor, input(slug));
  await upsertDoc(actor.locationId, "location.ai", { brandVoice: "SECRET-VOICE", outreachConfig: { visionIdPrompt: "SECRET-PROMPT" } });
  const site = await getPublishedWebsite(db, slug);
  assert.equal(site?.settings.title, "Public brand");
  assert.equal(site?.settings.logoUrl, "");
  assert.doesNotMatch(JSON.stringify(site), /SECRET|NOT-PUBLIC|PRIVATE-PHONE|Private internal/);
});

test("identical slugs resolve inside one brand; draft/future content and stale unpublished-site reads are denied", async () => {
  const a = await brand(); const b = await brand(); const aSlug = unique("site-a"); const bSlug = unique("site-b");
  await saveWebsiteSettings(db, a, input(aSlug)); await saveWebsiteSettings(db, b, input(bSlug));
  const site = (await getPublishedWebsite(db, aSlug))!;
  await db.contentPage.createMany({ data: [
    { locationId: a.locationId, title: "A public", slug: "about", published: true, content: "A" },
    { locationId: b.locationId, title: "B private to A", slug: "about", published: true, content: "B" },
    { locationId: a.locationId, title: "Draft secret", slug: "draft", published: false, content: "DRAFT" },
  ] });
  await db.blogPost.createMany({ data: [
    { locationId: a.locationId, title: "Post A", slug: "news", published: true, publishedAt: new Date() },
    { locationId: b.locationId, title: "Post B", slug: "news", published: true },
    { locationId: a.locationId, title: "Future secret", slug: "future", published: true, publishedAt: new Date(Date.now() + 86_400_000) },
    { locationId: a.locationId, title: "Draft secret", slug: "draft", published: false },
  ] });
  assert.equal((await getWebsitePage(db, site, "about"))?.content, "A");
  assert.equal(await getWebsitePage(db, site, "draft"), null);
  assert.deepEqual((await listWebsitePages(db, site)).map((row) => row.title), ["A public"]);
  assert.equal((await getWebsitePost(db, site, "news"))?.title, "Post A");
  assert.equal(await getWebsitePost(db, site, "future"), null);
  assert.equal(await getWebsitePost(db, site, "draft"), null);
  assert.deepEqual((await listWebsitePosts(db, site)).map((row) => row.title), ["Post A"]);
  await saveWebsiteSettings(db, a, { ...input(aSlug), published: false });
  assert.equal(await getPublishedWebsite(db, aSlug), null);
  assert.equal(await getWebsitePage(db, site, "about"), null);
  assert.equal(await getWebsitePost(db, site, "news"), null);
  assert.deepEqual(await listWebsitePages(db, site), []);
  assert.deepEqual(await listWebsitePosts(db, site), []);
});

test("website writes require current connected Substo admin authority", async () => {
  const member = await brand("substo", "MEMBER");
  const estio = await brand("estio");
  assert.ok("error" in await saveWebsiteSettings(db, member, input(unique("denied"))));
  assert.ok("error" in await saveWebsiteSettings(db, estio, input(unique("denied"))));
  const actor = await brand();
  const foreign = await brand();
  assert.ok("error" in await saveWebsiteSettings(db, { ...actor, locationId: foreign.locationId }, input(unique("denied"))));
  await db.userLocationRole.deleteMany({ where: { userId: actor.userId } });
  assert.ok("error" in await saveWebsiteSettings(db, actor, input(unique("revoked"))));
  assert.equal(await db.location.count({ where: { id: { in: [member.locationId, estio.locationId, actor.locationId, foreign.locationId] }, websiteSlug: { not: null } } }), 0);
});

test("website address races have one winner and address changes require explicit confirmation", async () => {
  const a = await brand(); const b = await brand(); const slug = unique("race");
  const results = await Promise.all([saveWebsiteSettings(db, a, input(slug)), saveWebsiteSettings(db, b, input(slug))]);
  assert.equal(results.filter((row) => "message" in row).length, 1);
  assert.equal(await db.location.count({ where: { websiteSlug: slug } }), 1);
  const winner = (await getPublishedWebsite(db, slug))!.locationId === a.locationId ? a : b;
  const next = unique("renamed");
  assert.ok("error" in await saveWebsiteSettings(db, winner, input(next)));
  assert.ok(await getPublishedWebsite(db, slug));
  assert.ok("message" in await saveWebsiteSettings(db, winner, { ...input(next), confirmAddressChange: true }));
  assert.equal(await getPublishedWebsite(db, slug), null);
  assert.ok(await getPublishedWebsite(db, next));
});


test("shared website design saves only public fields inside the actor's current Substo brand", async () => {
  const actor = await brand(); const other = await brand(); const estio = await brand("estio");
  const form = new FormData(); form.set("locationId", actor.locationId); form.set("brandName", "Shared design");
  form.set("primaryColor", "#123456"); form.set("contactEmail", "public@example.com"); form.set("googleAiApiKey", "FORGED");
  await saveWebsiteDesign(db, actor, form);
  const layout = await docPayload(actor.locationId, "location.public_site");
  assert.doesNotMatch(JSON.stringify(layout), /FORGED|#123456/);
  const slug = unique("shared-design");
  await saveWebsiteSettings(db, actor, input(slug));
  const published = await getPublishedWebsite(db, slug);
  assert.equal(published?.settings.title, "Shared design");
  assert.equal(published?.settings.email, "public@example.com");
  assert.equal(published?.settings.accent, "#123456");
  form.set("locationId", other.locationId);
  assert.match((await saveWebsiteDesign(db, actor, form)).message, /access is required/);
  assert.equal(await docPayload(other.locationId, "location.public_site"), null);
  form.set("locationId", estio.locationId);
  assert.match((await saveWebsiteDesign(db, { ...actor, locationId: estio.locationId }, form)).message, /access is required/);
  form.set("locationId", actor.locationId);
  await db.userLocationRole.delete({ where: { userId_locationId: { userId: actor.userId, locationId: actor.locationId } } });
  assert.match((await saveWebsiteDesign(db, actor, form)).message, /access is required/);
});


test("published homepage uses shared section storage and sanitizes it without repeating its URL base", async () => {
  const actor = await brand(); const slug = unique("home-shared");
  await saveWebsiteSettings(db, actor, input(slug));
  await saveLayout(actor.locationId, { heroContent: { headline: "Shared homepage", ctaLink: "/about" }, homeSections: [{ type: "text", enabled: true, order: 1, htmlContent: '<p onclick="bad()">Welcome</p>' }, { type: "hero", enabled: true, order: 0 }, { type: "featured-properties", enabled: true, order: 2 }] });
  const site = (await getPublishedWebsite(db, slug))!;
  assert.deepEqual(site.homeBlocks?.map(block => block.type), ["hero", "text"]);
  assert.equal(site.homeBlocks?.[0].ctaLink, `/sites/${slug}/about`);
  assert.doesNotMatch(JSON.stringify(site.homeBlocks), /onclick|featured-properties/);
});
