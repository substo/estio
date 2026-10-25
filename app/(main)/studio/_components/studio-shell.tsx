"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SignedIn, UserButton } from "@clerk/nextjs";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import {
  BookOpenText,
  CalendarClock,
  ChevronsUpDown,
  Clapperboard,
  Compass,
  Layers,
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
import { ProductSwitcher } from "@/components/product-switcher";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import DashboardSideBar from "../../admin/_components/dashboard-side-bar";
import { AdminNavigationGroups, type AdminNavGroup } from "../../admin/_components/admin-navigation";
import { AdminSidebarPreferenceScript, useSidebarCollapsed } from "../../admin/_components/admin-shell-layout";
import { openEstioStudioBusinessAction, openSubstoBrandStudioAction, openSubstoStudioCrmAction } from "../actions";

type App = "estio" | "substo";

export type StudioShellBrand = { id: string; name: string };

const WORKSPACE_PATH = /^\/studio\/workspace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** Sidebar menu for Studio, in the same groups and style as the CRM menu. */
export function studioNavGroups(app: App, workspaceId: string | null): AdminNavGroup[] {
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
        { href: "/brand/team", label: "Team", icon: UsersRound, activePath: (pathname) => pathname.startsWith("/brand/team") },
        { href: "/brand/settings", label: "Brand settings", icon: Settings, activePath: (pathname) => pathname.startsWith("/brand/settings") },
        { href: "/studio?choose=1", label: "All brands", icon: Layers, activePath: (pathname) => pathname === "/studio" },
      ],
    });
  } else {
    groups.push({ label: "Workspace", items: [{ href: "/studio", label: "Locations", icon: Layers, activePath: (pathname) => pathname === "/studio" }] });
  }
  return groups;
}

/** Substo: switch the active brand. Each option re-checks membership on the server. */
function BrandSwitcher({ brands, activeBrandId }: { brands: StudioShellBrand[]; activeBrandId: string | null }) {
  const active = brands.find((brand) => brand.id === activeBrandId);
  if (brands.length === 0) return null;
  if (brands.length === 1) return <span className="truncate text-sm font-medium">{brands[0].name}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 max-w-[16rem] items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
        <span className="truncate">{active?.name ?? "Choose a brand"}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your brands</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {brands.map((brand) => (
          <DropdownMenuItem key={brand.id} asChild>
            <form action={openSubstoBrandStudioAction} className="w-full">
              <input type="hidden" name="brandId" value={brand.id} />
              <button type="submit" className="w-full truncate text-left" aria-current={brand.id === activeBrandId ? "true" : undefined}>{brand.name}</button>
            </form>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/studio?choose=1">Create or manage brands</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Studio and brand pages use the same shell as the CRM: collapsible sidebar
 * with the logo, product switch and menu, and a top bar.
 */
export function StudioShell({
  app,
  brands,
  activeBrandId,
  activeLocationName,
  fallbackWorkspaceId,
  children,
}: {
  app: App;
  brands: StudioShellBrand[];
  activeBrandId: string | null;
  /** Estio: the active location shown in the top bar. */
  activeLocationName: string | null;
  /** Workspace for menu links on pages outside /studio/workspace (brand pages). */
  fallbackWorkspaceId: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useSidebarCollapsed();
  const workspaceId = pathname.match(WORKSPACE_PATH)?.[1] ?? fallbackWorkspaceId;
  const groups = studioNavGroups(app, workspaceId);
  const targets = {
    crm: workspaceId
      ? { action: (app === "substo" ? openSubstoStudioCrmAction : openEstioStudioBusinessAction).bind(null, workspaceId) }
      : { href: "/admin" },
    studio: { href: "/studio" },
  };
  const switcher = <ProductSwitcher active="studio" compact={collapsed} className={collapsed ? "mx-3.5" : "mx-3"} targets={targets} />;
  const logo = <AppLogo app={app} href={app === "substo" ? "/studio" : "/"} size="sm" showName iconOnly={collapsed} className={collapsed ? "justify-center" : "min-w-0"} />;

  return (
    <>
      <AdminSidebarPreferenceScript />
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
            {app === "substo"
              ? <BrandSwitcher brands={brands} activeBrandId={activeBrandId} />
              : activeLocationName ? <span className="truncate text-sm font-medium">{activeLocationName}</span> : null}
            <div className="ml-auto flex items-center gap-2">
              {config.auth.enabled ? <SignedIn><UserButton afterSignOutUrl="/sign-in" /></SignedIn> : null}
              <ModeToggle />
            </div>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}
