"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft, Bell, Database, Images, Laptop, LayoutDashboard, MessagesSquare,
  PlugZap, Radio, Radar, Settings, Sparkles, UsersRound, type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
import type { AppShellData } from "@/components/app-shell/types";
import type { ReactNode } from "react";
import type { SettingsSection } from "./sections";

type Product = "crm" | "studio";
const PRODUCTS: Record<Product, { href: string; label: string }> = { crm: { href: "/admin", label: "CRM" }, studio: { href: "/studio", label: "Studio" } };
const STORAGE_KEY = "estio.settings.from";
const fromPath = (path: string | null): Product | null => !path ? null : /^\/admin(\/|$)/.test(path) ? "crm" : /^\/studio(\/|$)/.test(path) ? "studio" : null;

/** Which product the person came from: ?from=, then the last value this tab saw, then the referring page on this origin. */
function useOrigin(fallback: Product): Product {
  const params = useSearchParams();
  const query = params.get("from");
  const [product, setProduct] = useState<Product>(fallback);
  useEffect(() => {
    let referrer: Product | null = null;
    try { const url = document.referrer ? new URL(document.referrer) : null; referrer = url && url.origin === window.location.origin ? fromPath(url.pathname) : null; } catch { referrer = null; }
    const stored = (() => { try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; } })();
    const next = query === "crm" || query === "studio" ? query : (stored === "crm" || stored === "studio" ? stored : null) ?? referrer ?? fallback;
    setProduct(next);
    try { sessionStorage.setItem(STORAGE_KEY, next); } catch { /* private mode */ }
  }, [query, fallback]);
  return query === "crm" || query === "studio" ? query : product;
}

const sectionIcons: Record<string, LucideIcon> = {
  "/settings": LayoutDashboard,
  "/settings/ai": Sparkles,
  "/settings/computer": Laptop,
  "/settings/team": UsersRound,
  "/settings/notifications": Bell,
  "/settings/conversations": MessagesSquare,
  "/settings/live-assist": Radio,
  "/settings/integrations": PlugZap,
  "/settings/prospecting": Radar,
  "/settings/media": Images,
  "/settings/location-data": Database,
};

export function SettingsShell({ shell, sections, tenantHost, children }: {
  shell: AppShellData;
  sections: SettingsSection[];
  tenantHost: boolean;
  children: ReactNode;
}) {
  const origin = useOrigin(shell.app === "substo" ? "studio" : "crm");
  const product = tenantHost ? "crm" : origin;
  const links = [{ href: "/settings", label: "Overview" }, ...sections];
  const navigation = {
    groups: [{
      label: "Settings",
      items: links.map(({ href, label }) => ({
        href: `${href}?from=${product}`,
        label,
        icon: sectionIcons[href] ?? Settings,
        activePath: (pathname: string) => pathname === href || (href !== "/settings" && pathname.startsWith(`${href}/`)),
      })),
    }],
    footer: { href: PRODUCTS[product].href, label: `Back to ${PRODUCTS[product].label}`, icon: ArrowLeft, activePath: () => false },
  };
  return <AppShell product={product} {...shell} navigation={navigation}>
    <div className="min-w-0 p-4 lg:p-6">{children}</div>
  </AppShell>;
}
