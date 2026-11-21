"use client";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell/app-shell";
import type { AppShellData } from "@/components/app-shell/types";
import type { ReactNode } from "react";
import type { SettingsSection } from "./sections";

type Product = "crm" | "studio";
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

export function SettingsShell({ shell, sections, tenantHost, children }: {
  shell: AppShellData;
  sections: SettingsSection[];
  tenantHost: boolean;
  children: ReactNode;
}) {
  const origin = useOrigin(shell.app === "substo" ? "studio" : "crm");
  const product = tenantHost ? "crm" : origin;
  return <AppShell product={product} {...shell} settingsSections={sections}>
    <div className="min-w-0 p-4 lg:p-6">{children}</div>
  </AppShell>;
}
