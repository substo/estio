import {
  BookOpenText,
  CalendarClock,
  Clapperboard,
  Compass,
  Laptop,
  LayoutDashboard,
  Library,
  ListChecks,
  PlugZap,
  Settings,
  Sparkles,
  UsersRound,
} from "lucide-react"
import type { ProductKey, ProductTarget } from "@/components/product-switcher"
import type { AdminNavGroup } from "@/app/(main)/admin/_components/admin-navigation"
import { openEstioStudioLocation } from "@/app/(main)/studio/actions"
import type { ShellApp } from "./types"

export type ProductShellConfig = {
  /** Where the logo and mobile title lead within the current product. */
  homeHref: string
  targets: Record<ProductKey, ProductTarget>
  /** Undefined selects the CRM menu (realm-filtered by AdminNavigationGroups). */
  navGroups: AdminNavGroup[] | undefined
}

/** Sidebar menu for Studio, in the same groups and style as the CRM menu. */
export function studioNavGroups(app: ShellApp, studioLocationId: string | null, locationId: string | null = null): AdminNavGroup[] {
  const base = studioLocationId ? `/studio` : null
  const groups: AdminNavGroup[] = []
  if (base) {
    groups.push({
      items: [
        { href: base, label: "Overview", icon: LayoutDashboard, activePath: (pathname) => pathname === base },
        { href: `${base}/brand-profile`, label: "Brand profile", icon: Sparkles, activePath: (pathname) => pathname.startsWith(`${base}/brand-profile`) || pathname.startsWith(`${base}/onboarding`) },
        { href: `${base}/library`, label: "Library", icon: Library, activePath: (pathname) => pathname.startsWith(`${base}/library`) || pathname.startsWith(`${base}/records`) },
        { href: `${base}/content`, label: "Content", icon: Clapperboard, activePath: (pathname) => pathname.startsWith(`${base}/content`) },
        { href: `${base}/knowledge`, label: "Knowledge", icon: BookOpenText, activePath: (pathname) => pathname.startsWith(`${base}/knowledge`) },
        { href: `${base}/youtube`, label: "Discovery", icon: Compass, activePath: (pathname) => pathname.startsWith(`${base}/youtube`) },
        { href: `${base}/schedules`, label: "Schedules", icon: CalendarClock, activePath: (pathname) => pathname.startsWith(`${base}/schedules`) },
        { href: `${base}/jobs`, label: "Jobs", icon: ListChecks, activePath: (pathname) => pathname.startsWith(`${base}/jobs`) },
      ],
    })
  }
  const settings: AdminNavGroup["items"] = []
  if (base) settings.push(
    { href: `${base}/settings/ai`, label: "AI settings", icon: Sparkles, activePath: (pathname) => pathname.startsWith(`${base}/settings/ai`) },
    { href: `${base}/settings/computer`, label: "Connected computer", icon: Laptop, activePath: (pathname) => pathname.startsWith(`${base}/settings/computer`) },
  )
  settings.push({ href: "/account/connections", label: "My connections", icon: PlugZap, activePath: (pathname) => pathname.startsWith("/account/connections") })
  if (app === "substo" && locationId) {
    settings.push(
      { href: "/brand/team", label: "Team", icon: UsersRound, activePath: (pathname) => pathname.startsWith("/brand/team") },
      { href: "/brand/settings", label: "General", icon: Settings, activePath: (pathname) => pathname.startsWith("/brand/settings") },
    )
  } else if (app === "estio" && locationId) {
    settings.push({ href: "/admin/team", label: "Team", icon: UsersRound, activePath: (pathname) => pathname.startsWith("/admin/team"), formTarget: { action: "/api/studio/tenant-switch", fields: { product: "team", locationId } } })
  }
  groups.push({ label: "Settings", items: settings })
  return groups
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
    navGroups: studioNavGroups(app, studioLocationId, locationId),
    targets: {
      crm: locationId ? { formAction: "/api/studio/tenant-switch", fields: { product: "crm", locationId } } : { href: "/admin", document: true },
      studio: { href: "/studio" },
    },
  }
}
