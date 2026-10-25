import { notFound } from "next/navigation";
import type { ReactNode, CSSProperties } from "react";
import { loadPublicWebsite } from "@/lib/substo-sites/request";
import { listWebsitePages } from "@/lib/substo-sites/service";
import { sitePath } from "@/lib/substo-sites/policy";
import db from "@/lib/db";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  return site ? { title: { default: site.settings.title, template: `%s | ${site.settings.title}` }, description: site.settings.description, icons: { icon: "/images/substo-mark.svg" } } : {};
}
export default async function WebsiteLayout({ children, params }: { children: ReactNode; params: Promise<{ siteSlug: string }> }) {
  const site = await loadPublicWebsite((await params).siteSlug);
  if (!site) notFound();
  const pages = await listWebsitePages(db, site);
  const base = sitePath(site.slug);
  return <div className="min-h-screen" style={{ "--site-accent": site.settings.accent } as CSSProperties}>
    <header className="border-b"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-6 py-6">
      <a href={base} className="flex items-center gap-3 text-xl font-semibold">{site.settings.logoUrl ? <img className="h-10 max-w-40 object-contain" src={site.settings.logoUrl} alt="" referrerPolicy="no-referrer" /> : null}{site.settings.title}</a>
      <nav aria-label="Website" className="flex flex-wrap gap-5 text-sm"><a href={base}>Home</a>{pages.filter((page) => page.slug !== "home").map((page) => <a key={page.slug} href={`${base}/${encodeURIComponent(page.slug)}`}>{page.title}</a>)}<a href={`${base}/blog`}>Blog</a></nav>
    </div></header>
    <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>
    <footer className="mt-12 border-t"><div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-6 py-8 text-sm text-slate-600"><span>{site.settings.title}</span>{site.settings.email ? <a href={`mailto:${site.settings.email}`}>Contact us</a> : null}<a href={base}>Powered by Substo</a></div></footer>
  </div>;
}
