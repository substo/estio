import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import db from "@/lib/db";
import { getSubstoBrandActor } from "@/lib/brands/substo-brands";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { sitePath, websiteSettings } from "@/lib/substo-sites/policy";
import { WebsiteForm } from "./website-form";
export default async function WebsiteSettingsPage() {
  const actor = await getSubstoBrandActor();
  if (!actor) notFound();
  const row = await db.siteConfig.findUnique({ where: { locationId: actor.locationId }, select: { substoSiteSlug: true, substoSitePublished: true, substoSiteConfig: true } });
  const origin = getHostOrigin((await headers()).get("host")) || "";
  return <div className="space-y-6 p-6"><div><h1 className="text-2xl font-semibold">Brand website</h1><p className="mt-2 max-w-2xl text-muted-foreground">Publish your brand’s pages and blog on Substo. Use the shared homepage editor, page editor and blog editor to build your website.</p></div><div className="flex flex-wrap gap-4 text-sm"><Link className="underline" href="/admin/content/pages">Manage pages</Link><Link className="underline" href="/admin/content/home">Edit homepage</Link><Link className="underline" href="/admin/content/posts">Manage blog posts</Link><Link className="underline" href="/admin/site-settings">Theme and contact details</Link><Link className="underline" href="/admin/site-settings/navigation">Navigation and footer</Link>{row?.substoSitePublished && row.substoSiteSlug ? <a className="underline" href={sitePath(row.substoSiteSlug)} target="_blank" rel="noopener noreferrer">View website</a> : null}</div>{actor.role === "ADMIN" ? <WebsiteForm key={`${actor.locationId}:${row?.substoSiteSlug}:${row?.substoSitePublished}`} origin={origin} slug={row?.substoSiteSlug || `brand-${actor.locationId.slice(-10)}`} published={row?.substoSitePublished ?? false} settings={websiteSettings(row?.substoSiteConfig, actor.brandName)} /> : <p className="text-sm text-muted-foreground">Only brand admins can change website settings or publish the website.</p>}</div>;
}
