"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SignedIn, UserButton } from "@clerk/nextjs";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import {
  BookOpenText,
  CalendarClock,
  Clapperboard,
  Compass,
  LayoutDashboard,
  Library,
  ListChecks,
  PlugZap,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react";
import config from "@/config";
import ModeToggle from "@/components/mode-toggle";
import { AppLogo } from "@/components/app-logo";
import { ProductSwitcher, type ProductTarget } from "@/components/product-switcher";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AppTenantIdentity } from "@/components/app-tenant-identity";
import { TenantSelector } from "@/components/tenant-selector";
import { TenantSelectionSync } from "./tenant-selection-sync";
import { ImpersonationBanner, type ImpersonationBannerData } from "../../admin/_components/impersonation-banner";
import DashboardSideBar from "../../admin/_components/dashboard-side-bar";
import { AdminNavigationGroups, type AdminNavGroup } from "../../admin/_components/admin-navigation";
import { AdminSidebarPreferenceScript, useSidebarCollapsed } from "../../admin/_components/admin-shell-layout";
import { openEstioStudioBusinessAction } from "../actions";

type App = "estio" | "substo";

export type StudioShellBrand = { id: string; name: string };

const WORKSPACE_PATH = /^\/studio\/workspace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** Sidebar menu for Studio, in the same groups and style as the CRM menu. */
export function studioNavGroups(app: App, workspaceId: string | null, locationId: string | null = null): AdminNavGroup[] {
  const scope = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  const base = workspaceId ? `/studio/workspace/${workspaceId}` : null;
  const groups: AdminNavGroup[] = [];
  if (base) {
    groups.push({
      items: [
        { href: base, label: "Overview", icon: LayoutDashboard, activePath: (pathname) => pathname === base },
        { href: `${base}/library`, label: "Library", icon: Library, activePath: (pathname) => pathname.startsWith(`${base}/library`) || pathname.startsWith(`${base}/records`) },
        { href: `${base}/content`, label: "Content", icon: Clapperboard, activePath: (pathname) => pathname.startsWith(`${base}/content`) },
        { href: `${base}/knowledge`, label: "Knowledge", icon: BookOpenText, activePath: (pathname) => pathname.startsWith(`${base}/knowledge`) },
        { href: `${base}/youtube`, label: "Discovery", icon: Compass, activePath: (pathname) => pathname.startsWith(`${base}/youtube`) },
        { href: `${base}/schedules`, label: "Schedules", icon: CalendarClock, activePath: (pathname) => pathname.startsWith(`${base}/schedules`) },
        { href: `${base}/jobs`, label: "Jobs", icon: ListChecks, activePath: (pathname) => pathname.startsWith(`${base}/jobs`) },
      ],
    });
  }
  const settings: AdminNavGroup["items"] = [];
  if (base) settings.push({ href: `${base}/settings/ai`, label: "AI settings", icon: Sparkles, activePath: (pathname) => pathname.startsWith(`${base}/settings`) });
  settings.push({ href: "/account/connections", label: "My connections", icon: PlugZap, activePath: (pathname) => pathname.startsWith("/account/connections") });
  groups.push({ label: "Settings", items: settings });
  if (app === "substo") {
    groups.push({
      label: "Brand",
      items: [
        { href: `/brand/team${scope}`, label: "Team", icon: UsersRound, activePath: (pathname) => pathname.startsWith("/brand/team") },
        { href: `/brand/settings${scope}`, label: "Brand settings", icon: Settings, activePath: (pathname) => pathname.startsWith("/brand/settings") },
      ],
    });
  }
  return groups;
}

/**
 * Studio and brand pages use the same shell as the CRM: collapsible sidebar
 * with the logo, product switch and menu, and a top bar.
 */
export function StudioShell({
  app,
  brands,
  activeBrandId,
  impersonation,
  fallbackWorkspaceId,
  children,
}: {
  app: App;
  brands: StudioShellBrand[];
  activeBrandId: string | null;
  impersonation?: ImpersonationBannerData | null;
  /** Workspace for menu links on pages outside /studio/workspace (brand pages). */
  fallbackWorkspaceId: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const workspaceId = pathname.match(WORKSPACE_PATH)?.[1] ?? fallbackWorkspaceId;
  const groups = studioNavGroups(app, workspaceId, activeBrandId);
  const targets: { crm: ProductTarget; studio: ProductTarget } = {
    crm: workspaceId
      ? app === "substo" ? { formAction: "/api/studio/product-switch", fields: { product: "crm", workspaceId } } : { action: openEstioStudioBusinessAction.bind(null, workspaceId) }
      : activeBrandId ? { formAction: "/api/studio/tenant-switch", fields: { product: "crm", locationId: activeBrandId } } : { href: "/admin", document: true },
    studio: { href: "/studio" },
  };
  const switcher = <ProductSwitcher active="studio" compact={collapsed} className={collapsed ? "mx-3.5" : "mx-3"} targets={targets} />;
  const logo = <AppLogo app={app} href={workspaceId ? `/studio/workspace/${workspaceId}` : "/studio?choose=1"} size="sm" showName iconOnly={collapsed} className={collapsed ? "justify-center" : "min-w-0"} />;

  return (
    <>
      <AdminSidebarPreferenceScript />
      {impersonation ? <ImpersonationBanner context={impersonation} /> : null}
      <div className="grid min-h-screen w-full lg:[grid-template-columns:var(--admin-sidebar-width,160px)_minmax(0,1fr)]">
        <DashboardSideBar
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          logo={logo}
          switcher={switcher}
          navigation={<AdminNavigationGroups collapsed={collapsed} groups={groups} />}
        />
        <div className="flex min-w-0 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-3 lg:h-[55px]">
            <Sheet>
              <SheetTrigger className="p-2 transition min-[1024px]:hidden" aria-label="Open menu">
                <HamburgerMenuIcon className="h-5 w-5" />
              </SheetTrigger>
              <SheetContent side="left" className="flex w-[85vw] max-w-[320px] flex-col p-0">
                <SheetHeader className="border-b p-4 text-left">
                  <SheetTitle className="font-bold">{app === "substo" ? "Substo" : "Estio"} Studio</SheetTitle>
                </SheetHeader>
                <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4">
                  <ProductSwitcher active="studio" targets={targets} />
                  <AdminNavigationGroups variant="mobile" groups={groups} />
                </div>
              </SheetContent>
            </Sheet>
            <AppTenantIdentity app={app} homeHref={workspaceId ? `/studio/workspace/${workspaceId}` : "/studio?choose=1"}>
              <TenantSelector activeLocationId={activeBrandId} locations={brands} noun={app === "substo" ? "brand" : "location"} onSelect={async (locationId) => {
                const form = document.createElement("form");
                form.method = "post"; form.action = "/api/studio/tenant-switch";
                for (const [name, value] of Object.entries({ locationId, product: "studio" })) {
                  const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
                }
                document.body.appendChild(form); form.submit();
              }} />
            </AppTenantIdentity>
            <div className="ml-auto flex items-center gap-2">
              {config.auth.enabled ? <SignedIn><UserButton afterSignOutUrl="/sign-in" /></SignedIn> : null}
              <ModeToggle />
            </div>
          </header>
          {workspaceId ? <TenantSelectionSync workspaceId={workspaceId} /> : null}
          {pathname === "/studio" ? null : <div className="flex gap-4 px-4 pt-3 text-xs text-muted-foreground">
            <Link href="/studio?choose=1">{app === "substo" ? "Manage brands" : "Manage locations"}</Link>
            {app === "estio" && activeBrandId ? <form action="/api/studio/tenant-switch" method="post">
              <input type="hidden" name="product" value="team" /><input type="hidden" name="locationId" value={activeBrandId} />
              <button type="submit">Team</button>
            </form> : null}
          </div>}
          {children}
        </div>
      </div>
    </>
  );
}
