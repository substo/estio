"use client";

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
import { TenantHeaderSelector } from "@/components/tenant-header-selector";
import type { PlatformLocationLoginOption } from "@/lib/auth/platform-location-options";
import { TenantSessionGuard } from "./tenant-session-guard";
import { StudioTenantProvider } from "./studio-tenant-context";
import { ImpersonationBanner, type ImpersonationBannerData } from "../../admin/_components/impersonation-banner";
import DashboardSideBar from "../../admin/_components/dashboard-side-bar";
import { AdminNavigationGroups, type AdminNavGroup } from "../../admin/_components/admin-navigation";
import { AdminSidebarPreferenceScript, useSidebarCollapsed } from "../../admin/_components/admin-shell-layout";

type App = "estio" | "substo";

export type StudioShellBrand = { id: string; name: string };


/** Sidebar menu for Studio, in the same groups and style as the CRM menu. */
export function studioNavGroups(app: App, workspaceId: string | null, locationId: string | null = null): AdminNavGroup[] {
  const scope = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  const base = workspaceId ? `/studio` : null;
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
  if (app === "substo" && locationId) {
    settings.push(
      { href: `/brand/team${scope}`, label: "Team", icon: UsersRound, activePath: (pathname) => pathname.startsWith("/brand/team") },
      { href: `/brand/settings${scope}`, label: "General", icon: Settings, activePath: (pathname) => pathname.startsWith("/brand/settings") },
    );
  } else if (app === "estio" && locationId) {
    settings.push({ href: "/admin/team", label: "Team", icon: UsersRound, activePath: (pathname) => pathname.startsWith("/admin/team"), formTarget: { action: "/api/studio/tenant-switch", fields: { product: "team", locationId } } });
  }
  groups.push({ label: "Settings", items: settings });
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
  platformLoginLocations,
  impersonation,
  fallbackWorkspaceId,
  children,
}: {
  app: App;
  brands: StudioShellBrand[];
  activeBrandId: string | null;
  platformLoginLocations?: PlatformLocationLoginOption[] | null;
  impersonation?: ImpersonationBannerData | null;
  /** Private storage mapping; tenant selection always uses the Location ID. */
  fallbackWorkspaceId: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const workspaceId = fallbackWorkspaceId;
  const groups = studioNavGroups(app, workspaceId, activeBrandId);
  const targets: { crm: ProductTarget; studio: ProductTarget } = {
    crm: activeBrandId ? { formAction: "/api/studio/tenant-switch", fields: { product: "crm", locationId: activeBrandId } } : { href: "/admin", document: true },
    studio: { href: "/studio" },
  };
  const switcher = <ProductSwitcher active="studio" compact={collapsed} className={collapsed ? "mx-3.5" : "mx-3"} targets={targets} />;
  const logo = <AppLogo app={app} href={workspaceId ? `/studio` : "/studio/select?choose=1"} size="sm" showName iconOnly={collapsed} className={collapsed ? "justify-center" : "min-w-0"} />;

  return (
    <StudioTenantProvider locationId={activeBrandId}>
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
            <TenantHeaderSelector app={app} product="studio" activeLocationId={activeBrandId} locations={brands} platformLoginLocations={platformLoginLocations} />
            <div className="ml-auto flex items-center gap-2">
              {config.auth.enabled ? <SignedIn><UserButton afterSignOutUrl="/sign-in" /></SignedIn> : null}
              <ModeToggle />
            </div>
          </header>
          <TenantSessionGuard locationId={activeBrandId} />
          {children}
        </div>
      </div>
    </StudioTenantProvider>
  );
}
