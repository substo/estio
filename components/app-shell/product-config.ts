import {
  Bell,
  BookOpenText,
  Database,
  Images,
  Laptop,
  Mic,
  MessagesSquare,
  PlugZap,
  Radar,
  Radio,
  UsersRound,
  CalendarClock,
  Clapperboard,
  Compass,
  LayoutDashboard,
  Library,
  ListChecks,
  Settings,
  Sparkles,
} from "lucide-react"
import type { ProductKey, ProductTarget } from "@/components/product-switcher"
import type { AdminNavGroup } from "@/app/(main)/admin/_components/admin-navigation"
import { openEstioStudioLocation } from "@/app/(main)/studio/actions"
import type { SettingsSection } from "@/app/(main)/settings/_components/sections"
import type { ShellApp } from "./types"

export type ProductShellConfig = {
  /** Where the logo and mobile title lead within the current product. */
  homeHref: string
  targets: Record<ProductKey, ProductTarget>
  /** Undefined selects the CRM menu (realm-filtered by AdminNavigationGroups). */
  navGroups: AdminNavGroup[] | undefined
}

/** Sidebar menu for Studio, in the same groups and style as the CRM menu. */
export function studioNavGroups(studioLocationId: string | null): AdminNavGroup[] {
  const base = studioLocationId ? `/studio` : null
  const groups: AdminNavGroup[] = []
  if (base) {
    groups.push({
      items: [
        { href: base, label: "Overview", icon: LayoutDashboard, activePath: (pathname) => pathname === base },
        { href: `${base}/brand-profile`, label: "Brand profile", icon: Sparkles, activePath: (pathname) => pathname.startsWith(`${base}/brand-profile`) || pathname.startsWith(`${base}/onboarding`) },
        { href: `${base}/library`, label: "Library", icon: Library, activePath: (pathname) => pathname.startsWith(`${base}/library`) || pathname.startsWith(`${base}/records`) },
        { href: `${base}/content`, label: "Content", icon: Clapperboard, activePath: (pathname) => pathname.startsWith(`${base}/content`) },
        { href: `${base}/voices`, label: "Voices", icon: Mic, activePath: (pathname) => pathname.startsWith(`${base}/voices`) },
        { href: `${base}/knowledge`, label: "Knowledge", icon: BookOpenText, activePath: (pathname) => pathname.startsWith(`${base}/knowledge`) },
        { href: `${base}/youtube`, label: "Discovery", icon: Compass, activePath: (pathname) => pathname.startsWith(`${base}/youtube`) },
        { href: `${base}/schedules`, label: "Schedules", icon: CalendarClock, activePath: (pathname) => pathname.startsWith(`${base}/schedules`) },
        { href: `${base}/jobs`, label: "Jobs", icon: ListChecks, activePath: (pathname) => pathname.startsWith(`${base}/jobs`) },
      ],
    })
  }
  return groups
}

const settingsIcons: Record<string, typeof Settings> = {
  "/settings": LayoutDashboard,
  "/account/connections": PlugZap,
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
}

export function settingsNavGroup(product: ProductKey, sections: SettingsSection[]): AdminNavGroup {
  const location = sections.filter(section => section.scope !== "account")
  const account = sections.filter(section => section.scope === "account")
  return {
    label: "Settings",
    disclosure: { icon: Settings, bottom: true },
    items: [{ href: "/settings", label: "Overview" }, ...location, ...account].map(({ href, label }) => ({
      href: `${href}?from=${product}`,
      label,
      icon: settingsIcons[href] ?? Settings,
      activePath: pathname => pathname === href || (href !== "/settings" && pathname.startsWith(`${href}/`)),
    })),
  }
}

/**
 * Per-product configuration of the one shell. Both products open the other for the
 * tenant shown in the header; the server re-checks access before switching.
 */
export function productShellConfig(
  app: ShellApp,
  product: ProductKey,
  { locationId, studioLocationId }: { locationId: string | null; studioLocationId: string | null }
): ProductShellConfig {
  if (product === "crm") {
    return {
      homeHref: app === "substo" ? "/admin" : "/",
      navGroups: undefined,
      targets: {
        crm: { href: "/admin" },
        studio: !locationId ? { href: "/studio", document: true }
          : app === "substo" ? { formAction: "/api/studio/product-switch", fields: { product: "studio", brandId: locationId } }
          : { action: openEstioStudioLocation, fields: { locationId } },
      },
    }
  }
  return {
    homeHref: studioLocationId ? "/studio" : "/studio/select?choose=1",
    navGroups: studioNavGroups(studioLocationId),
    targets: {
      crm: locationId ? { formAction: "/api/studio/tenant-switch", fields: { product: "crm", locationId } } : { href: "/admin", document: true },
      studio: { href: "/studio" },
    },
  }
}
