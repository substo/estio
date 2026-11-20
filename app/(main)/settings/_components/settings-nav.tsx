"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "./sections";

type Product = "crm" | "studio";
const PRODUCTS: Record<Product, { href: string; label: string }> = { crm: { href: "/admin", label: "CRM" }, studio: { href: "/studio", label: "Studio" } };
const STORAGE_KEY = "estio.settings.from";
const fromPath = (path: string | null): Product | null => !path ? null : /^\/admin(\/|$)/.test(path) ? "crm" : /^\/studio(\/|$)/.test(path) ? "studio" : null;

/** Which product the person came from: ?from=, then the last value this tab saw, then the referring page on this origin. */
function useOrigin(fallback: Product): Product {
  const params = useSearchParams();
  const [product, setProduct] = useState<Product>(fallback);
  useEffect(() => {
    const query = params.get("from");
    let referrer: Product | null = null;
    try { const url = document.referrer ? new URL(document.referrer) : null; referrer = url && url.origin === window.location.origin ? fromPath(url.pathname) : null; } catch { referrer = null; }
    const stored = (() => { try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; } })();
    const next = query === "crm" || query === "studio" ? query : (stored === "crm" || stored === "studio" ? stored : null) ?? referrer ?? fallback;
    setProduct(next);
    try { sessionStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  }, [params, fallback]);
  return product;
}

export function SettingsBackLink({ fallback }: { fallback: Product }) {
  const product = useOrigin(fallback);
  return <Link href={PRODUCTS[product].href} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:underline">
    <ArrowLeft aria-hidden className="h-4 w-4" />Back to {PRODUCTS[product].label}
  </Link>;
}

export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();
  const links = [{ href: "/settings", label: "Overview" }, ...sections];
  return <nav aria-label="Settings sections">
    <ul className="flex max-w-full gap-1 overflow-x-auto md:flex-col">
      {links.map(section => {
        const current = pathname === section.href;
        const active = current || (section.href !== "/settings" && pathname.startsWith(`${section.href}/`));
        return <li key={section.href}>
          <Link href={section.href} aria-current={current ? "page" : active ? "location" : undefined}
            className={cn("flex min-h-11 items-center whitespace-nowrap rounded-md px-3 text-sm hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2", active ? "bg-accent font-medium" : "text-muted-foreground")}>{section.label}</Link>
        </li>;
      })}
    </ul>
  </nav>;
}
