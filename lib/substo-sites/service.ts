import { homeSectionBlocks } from "@/lib/website/home-sections";
import { hostedBlocks } from "@/lib/website/hosted-content";
import { hostedWebsiteConfig, websiteDesignSelect } from "@/lib/website/config";
import type { PrismaClient } from "@prisma/client";
import { safeImageUrl, siteSlug, websiteSettings, type WebsiteSettings } from "./policy";
import { businessProfileSchema } from "@/lib/business-profile/schema";
import { businessView, type BusinessDetailsPatch } from "@/lib/business-profile/view";
import { overlayBusinessDetails } from "@/lib/business-profile/overlay";

export type SiteDatabase = Pick<PrismaClient, "siteConfig" | "contentPage" | "blogPost" | "location" | "settingsDocument">;
/** Business details (contact, colours, logos, description) are saved to the Business profile by the caller's saver. */
export type BusinessSaver = (locationId: string, patch: BusinessDetailsPatch, actorUserId: string) => Promise<unknown>;
/** The Location's Business profile view, read through the same database handle; null when it has no profile yet. */
async function profileView(db: SiteDatabase, locationId: string, name: string | null) {
  const doc = await db.settingsDocument.findUnique({ where: { scopeType_scopeId_domain: { scopeType: "LOCATION", scopeId: locationId, domain: "location.business" } } });
  const parsed = doc ? businessProfileSchema.safeParse(doc.payload) : null;
  return parsed?.success ? businessView(parsed.data, { name }) : null;
}
export type PublicWebsite = { slug: string; locationId: string; settings: WebsiteSettings; config?: ReturnType<typeof hostedWebsiteConfig>; homeBlocks?: any[] };
export type WebsiteActor = { userId: string; locationId: string; role: string };

const publicSiteWhere = (slug: string) => ({ authRealm: "substo" as const, siteConfig: { substoSiteSlug: slug, substoSitePublished: true } });

/** Explicit allowlist projection: never serialize SiteConfig secrets or Location credentials. */
export async function getPublishedWebsite(db: SiteDatabase, slug: string): Promise<PublicWebsite | null> {
  if (siteSlug(slug) !== slug) return null;
  const row = await db.siteConfig.findFirst({
    where: { substoSiteSlug: slug, substoSitePublished: true, location: { authRealm: "substo" } },
    select: { homeSections: true, heroContent: true, ...websiteDesignSelect, locationId: true, substoSiteSlug: true, substoSiteConfig: true, location: { select: { name: true } } },
  });
  if (!row) return null;
  const config = hostedWebsiteConfig(overlayBusinessDetails(row, await profileView(db, row.locationId, row.location.name)), slug, row.location.name || "Our brand");
  const settings = { title: config.name, description: config.footerBio, email: config.contactInfo.email, accent: config.theme.primaryColor, logoUrl: config.theme.logo.url };
  return { slug, locationId: row.locationId, settings, config, homeBlocks: Array.isArray(row.homeSections) ? hostedBlocks(homeSectionBlocks(row, false), slug, config) : undefined };
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
  return db.contentPage.findFirst({ where: { ...publishedPageWhere(site), slug }, select: { title: true, content: true, blocks: true, headerStyle: true, heroImage: true, metaTitle: true, metaDescription: true, updatedAt: true } });
}
export async function listWebsitePosts(db: SiteDatabase, site: PublicWebsite) {
  return db.blogPost.findMany({ where: publishedPostWhere(site), select: { slug: true, title: true, excerpt: true, coverImage: true, publishedAt: true, updatedAt: true }, orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }], take: 50 });
}
export async function getWebsitePost(db: SiteDatabase, site: PublicWebsite, slug: string) {
  return db.blogPost.findFirst({ where: { ...publishedPostWhere(site), slug }, select: { title: true, excerpt: true, content: true, coverImage: true, authorName: true, publishedAt: true, updatedAt: true } });
}
export async function saveWebsiteSettings(db: SiteDatabase, actor: WebsiteActor, input: { slug: unknown; published: boolean; settings: unknown; confirmAddressChange?: boolean }, saveBusiness?: BusinessSaver) {
  if (actor.role !== "ADMIN") return { error: "Only brand admins can manage the website." };
  const slug = siteSlug(input.slug);
  if (!slug) return { error: "Use 3–63 lowercase letters, numbers or single hyphens for the address." };
  const location = await db.location.findFirst({ where: {
    id: actor.locationId, authRealm: "substo", users: { some: { id: actor.userId, authRealm: "substo" } },
    userRoles: { some: { userId: actor.userId, role: "ADMIN" } },
  }, select: { name: true } });
  if (!location) return { error: "Brand admin access is required." };
  const existing = await db.siteConfig.findUnique({ where: { locationId: actor.locationId }, select: { substoSiteSlug: true } });
  if (existing?.substoSiteSlug && existing.substoSiteSlug !== slug && !input.confirmAddressChange) return { error: "Confirm the address change. Existing links will stop working." };
  const settings = websiteSettings(input.settings, location.name || "Our brand");
  try {
    // Only the website title is layout; the description, email, accent colour and logo are business details.
    const data = { substoSiteSlug: slug, substoSitePublished: input.published, substoSiteConfig: { title: settings.title } };
    await db.siteConfig.upsert({ where: { locationId: actor.locationId }, create: { locationId: actor.locationId, ...data }, update: data });
    await saveBusiness?.(actor.locationId, { summary: settings.description || null, email: settings.email || null, colours: { primary: settings.accent || null }, logos: { primary: settings.logoUrl || null } }, actor.userId);
    return { message: input.published ? "Website published." : "Website saved. Public access is off." };
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { error: "That website address is already in use." };
    throw error;
  }
}

/** Edition adapter for the shared theme form. Authority and allowed write fields are checked here. */
export async function saveWebsiteDesign(db: SiteDatabase, actor: WebsiteActor, form: FormData, saveBusiness?: BusinessSaver) {
  const location = actor.role === "ADMIN" ? await db.location.findFirst({ where: {
    id: actor.locationId, authRealm: "substo", users: { some: { id: actor.userId, authRealm: "substo" } },
    userRoles: { some: { userId: actor.userId, role: "ADMIN" } },
  }, select: { id: true } }) : null;
  if (!location || form.get("locationId") !== actor.locationId) return { message: "Brand admin access is required." };
  const text = (key: string, max = 2000) => String(form.get(key) || "").trim().slice(0, max);
  const color = (key: string, fallback: string) => /^#[\da-f]{6}$/i.test(text(key)) ? text(key) : fallback;
  const image = (key: string) => safeImageUrl(text(key)) || "";
  const existing = await db.siteConfig.findUnique({ where: { locationId: actor.locationId }, select: { theme: true } });
  // Layout stays on the website settings; brand colours, logos and contact details go to the Business profile.
  const data = {
    theme: {
      backgroundColor: color("backgroundColor", "#ffffff"), textColor: color("textColor", "#000000"),
      logo: { textTop: text("brandName", 150), textBottom: text("brandTagline", 150) },
      headerStyle: text("headerStyle") === "transparent" ? "transparent" : "solid",
      menuStyle: (existing?.theme as any)?.menuStyle === "top" ? "top" : "side",
    },
  };
  await db.siteConfig.upsert({ where: { locationId: actor.locationId }, create: { locationId: actor.locationId, ...data }, update: data });
  const phones = [["Mobile", text("contactMobile")], ["Landline", text("contactLandline")]].filter(([, n]) => n).map(([label, number]) => ({ label, number }));
  const mapsLink = safeImageUrl(text("contactMapsLink")) || "";
  await saveBusiness?.(actor.locationId, {
    colours: { primary: color("primaryColor", "#111827"), secondary: color("secondaryColor", "#ffffff"), accent: color("accentColor", "#f5f5f5") },
    logos: { primary: image("logoUrl") || null, light: image("lightLogoUrl") || null, icon: image("iconUrl") || null, favicon: image("faviconUrl") || null },
    address: text("contactAddress") || null, phones, email: text("contactEmail", 254) || null,
    maps: mapsLink ? [{ url: mapsLink, title: text("contactMapsLinkTitle") || null }] : [],
  }, actor.userId);
  return { message: "Website design saved." };
}
