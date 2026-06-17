"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  BriefcaseBusiness,
  Building2,
  BarChart3,
  House,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Newspaper,
  PanelsTopLeft,
  Radar,
  Radio,
  SlidersHorizontal,
  SquareMenu,
  UsersRound,
} from "lucide-react"
import clsx from "clsx"
import { Button } from "@/components/ui/button"
import { SheetClose } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export type AdminNavItem = {
  href: string
  label: string
  icon: LucideIcon
  activePath: (pathname: string) => boolean
}

export type AdminNavGroup = {
  label?: string
  items: AdminNavItem[]
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    items: [
      {
        href: "/admin",
        label: "Overview",
        icon: LayoutDashboard,
        activePath: (pathname) => pathname === "/admin",
      },
      {
        href: "/admin/conversations",
        label: "Conversations",
        icon: MessagesSquare,
        activePath: (pathname) => pathname.includes("/admin/conversations"),
      },
      {
        href: "/admin/analytics",
        label: "Analytics",
        icon: BarChart3,
        activePath: (pathname) => pathname.includes("/admin/analytics"),
      },
      {
        href: "/admin/viewings/sessions",
        label: "Quick Assist",
        icon: Radio,
        activePath: (pathname) => pathname.includes("/admin/viewings/sessions"),
      },
    ],
  },
  {
    label: "CRM",
    items: [
      {
        href: "/admin/contacts",
        label: "Contacts",
        icon: UsersRound,
        activePath: (pathname) => pathname.includes("/admin/contacts"),
      },
      {
        href: "/admin/prospecting",
        label: "Prospects",
        icon: Radar,
        activePath: (pathname) => pathname.includes("/admin/prospecting") && !pathname.includes("/admin/prospecting/listings"),
      },
      {
        href: "/admin/companies",
        label: "Companies",
        icon: Building2,
        activePath: (pathname) => pathname.includes("/admin/companies"),
      },
      {
        href: "/admin/projects",
        label: "Projects",
        icon: BriefcaseBusiness,
        activePath: (pathname) => pathname.includes("/admin/projects"),
      },
    ],
  },
  {
    label: "Listings",
    items: [
      {
        href: "/admin/properties",
        label: "Properties",
        icon: House,
        activePath: (pathname) => pathname.includes("/admin/properties"),
      },
      {
        href: "/admin/prospecting/listings",
        label: "Listings Inbox",
        icon: Inbox,
        activePath: (pathname) => pathname.includes("/admin/prospecting/listings"),
      },
    ],
  },
  {
    label: "Content",
    items: [
      {
        href: "/admin/content/pages",
        label: "Pages",
        icon: PanelsTopLeft,
        activePath: (pathname) => pathname.includes("/admin/content/pages"),
      },
      {
        href: "/admin/content/posts",
        label: "Blog",
        icon: Newspaper,
        activePath: (pathname) => pathname.includes("/admin/content/posts"),
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        href: "/admin/site-settings/navigation",
        label: "Menus",
        icon: SquareMenu,
        activePath: (pathname) => pathname.includes("/admin/site-settings/navigation"),
      },
      {
        href: "/admin/settings",
        label: "Settings",
        icon: SlidersHorizontal,
        activePath: (pathname) => pathname.includes("/admin/settings"),
      },
    ],
  },
]

function AdminNavIcon({
  icon: Icon,
  active,
  variant,
  collapsed = false,
}: {
  icon: LucideIcon
  active: boolean
  variant: "desktop" | "mobile"
  collapsed?: boolean
}) {
  if (variant === "mobile") {
    return <Icon className="mr-3 h-4 w-4 text-muted-foreground" />
  }

  if (collapsed) {
    return (
      <Icon
        className={clsx(
          "h-5 w-5 shrink-0",
          active ? "text-gray-900 dark:text-gray-50" : "text-gray-500 dark:text-gray-400"
        )}
      />
    )
  }

  return (
    <span
      className={clsx(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-white dark:bg-black",
        active ? "border-gray-300 dark:border-gray-700" : "border-gray-300 dark:border-gray-800"
      )}
    >
      <Icon className="h-3 w-3" />
    </span>
  )
}

function AdminNavLink({ item, variant, collapsed = false }: { item: AdminNavItem; variant: "desktop" | "mobile"; collapsed?: boolean }) {
  const pathname = usePathname()
  const active = item.activePath(pathname)
  const Icon = item.icon

  if (variant === "mobile") {
    return (
      <SheetClose asChild>
        <Link href={item.href} prefetch>
          <Button variant="ghost" className="h-10 w-full justify-start font-normal">
            <AdminNavIcon icon={Icon} active={active} variant="mobile" />
            {item.label}
          </Button>
        </Link>
      </SheetClose>
    )
  }

  const desktopLink = (
    <Link
      href={item.href}
      prefetch
      aria-label={collapsed ? item.label : undefined}
      className={clsx(
        "flex min-h-10 min-w-0 items-center rounded-lg text-sm font-medium text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50",
        collapsed ? "h-10 w-10 justify-center p-0" : "gap-2 px-2.5 py-2",
        active && "bg-gray-100 text-gray-900 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-50 dark:hover:text-gray-50"
      )}
    >
      <AdminNavIcon icon={Icon} active={active} variant="desktop" collapsed={collapsed} />
      <span className={clsx(collapsed ? "sr-only" : "truncate")}>{item.label}</span>
    </Link>
  )

  if (!collapsed) {
    return desktopLink
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{desktopLink}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

export function AdminNavigationGroups({ variant = "desktop", collapsed = false }: { variant?: "desktop" | "mobile"; collapsed?: boolean }) {
  const compact = variant === "desktop" && collapsed

  return (
    <TooltipProvider delayDuration={150}>
      <nav className={clsx(variant === "mobile" ? "space-y-6" : compact ? "space-y-3 px-3.5 text-sm" : "space-y-4 px-3 text-sm")}>
        {ADMIN_NAV_GROUPS.map((group, index) => (
          <div key={group.label || `primary-${index}`} className={clsx(compact ? "space-y-1.5" : "space-y-1")}>
            {group.label && (
              <h4
                className={clsx(
                  "px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                  variant === "mobile" ? "mb-2 px-4" : compact ? "sr-only" : "mb-1"
                )}
              >
                {group.label}
              </h4>
            )}
            {group.items.map((item) => (
              <AdminNavLink key={item.href} item={item} variant={variant} collapsed={compact} />
            ))}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  )
}
