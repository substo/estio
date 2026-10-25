import type { PrismaClient } from "@prisma/client";
import { siteSlug, websiteSettings, type WebsiteSettings } from "./policy";

export type SiteDatabase = Pick<PrismaClient, "siteConfig" | "contentPage" | "blogPost" | "location">;
export type PublicWebsite = { slug: string; locationId: string; settings: WebsiteSettings };
export type WebsiteActor = { userId: string; locationId: string; role: string };

const publicSiteWhere = (slug: string) => ({ authRealm: "substo" as const, siteConfig: { substoSiteSlug: slug, substoSitePublished: true } });

/** Explicit allowlist projection: never serialize SiteConfig secrets or Location credentials. */
export async function getPublishedWebsite(db: SiteDatabase, slug: string): Promise<PublicWebsite | null> {
  if (siteSlug(slug) !== slug) return null;
  const row = await db.siteConfig.findFirst({
    where: { substoSiteSlug: slug, substoSitePublished: true, location: { authRealm: "substo" } },
    select: { locationId: true, substoSiteSlug: true, substoSiteConfig: true, location: { select: { name: true } } },
  });
  return row ? { slug, locationId: row.locationId, settings: websiteSettings(row.substoSiteConfig, row.location.name || "Our brand") } : null;
}
export function publishedPageWhere(site: PublicWebsite) {
  return { locationId: site.locationId, published: true, location: publicSiteWhere(site.slug) };
}
export function publishedPostWhere(site: PublicWebsite, now = new Date()) {
  return { ...publishedPageWhere(site), OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] };
}
export async function listWebsitePages(db: SiteDatabase, site: PublicWebsite) {
  return db.contentPage.findMany({ where: publishedPageWhere(site), select: { slug: true, title: true, updatedAt: true }, orderBy: { title: "asc" }, take: 100 });
}
export async function getWebsitePage(db: SiteDatabase, site: PublicWebsite, slug: string) {
  return db.contentPage.findFirst({ where: { ...publishedPageWhere(site), slug }, select: { title: true, content: true, blocks: true, metaTitle: true, metaDescription: true, updatedAt: true } });
}
export async function listWebsitePosts(db: SiteDatabase, site: PublicWebsite) {
  return db.blogPost.findMany({ where: publishedPostWhere(site), select: { slug: true, title: true, excerpt: true, publishedAt: true, updatedAt: true }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 50 });
}
export async function getWebsitePost(db: SiteDatabase, site: PublicWebsite, slug: string) {
  return db.blogPost.findFirst({ where: { ...publishedPostWhere(site), slug }, select: { title: true, excerpt: true, content: true, coverImage: true, authorName: true, publishedAt: true, updatedAt: true } });
}
export async function saveWebsiteSettings(db: SiteDatabase, actor: WebsiteActor, input: { slug: unknown; published: boolean; settings: unknown; confirmAddressChange?: boolean }) {
  if (actor.role !== "ADMIN") return { error: "Only brand admins can manage the website." };
  const slug = siteSlug(input.slug);
  if (!slug) return { error: "Use 3–63 lowercase letters, numbers or single hyphens for the address." };
  const brand = await db.location.findFirst({ where: {
    id: actor.locationId, authRealm: "substo", users: { some: { id: actor.userId, authRealm: "substo" } },
    userRoles: { some: { userId: actor.userId, role: "ADMIN" } },
  }, select: { name: true } });
  if (!brand) return { error: "Brand admin access is required." };
  const existing = await db.siteConfig.findUnique({ where: { locationId: actor.locationId }, select: { substoSiteSlug: true } });
  if (existing?.substoSiteSlug && existing.substoSiteSlug !== slug && !input.confirmAddressChange) return { error: "Confirm the address change. Existing links will stop working." };
  const settings = websiteSettings(input.settings, brand.name || "Our brand");
  try {
    const data = { substoSiteSlug: slug, substoSitePublished: input.published, substoSiteConfig: settings };
    await db.siteConfig.upsert({ where: { locationId: actor.locationId }, create: { locationId: actor.locationId, ...data }, update: data });
    return { message: input.published ? "Website published." : "Website saved. Public access is off." };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { error: "That website address is already in use." };
    throw error;
  }
}
