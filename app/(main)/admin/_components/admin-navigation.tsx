"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  Building,
  FileText,
  Home,
  Languages,
  Layers,
  LayoutTemplate,
  List,
  MessageSquare,
  Settings,
} from "lucide-react"
import clsx from "clsx"
import { Button } from "@/components/ui/button"
import { SheetClose } from "@/components/ui/sheet"

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
        icon: Home,
        activePath: (pathname) => pathname === "/admin",
      },
      {
        href: "/admin/conversations",
        label: "Conversations",
        icon: MessageSquare,
        activePath: (pathname) => pathname.includes("/admin/conversations"),
      },
      {
        href: "/admin/viewings/sessions",
        label: "Quick Assist",
        icon: Languages,
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
        icon: FileText,
        activePath: (pathname) => pathname.includes("/admin/contacts"),
      },
      {
        href: "/admin/prospecting",
        label: "Prospects",
        icon: Layers,
        activePath: (pathname) => pathname.includes("/admin/prospecting") && !pathname.includes("/admin/prospecting/listings"),
      },
      {
        href: "/admin/companies",
        label: "Companies",
        icon: Building,
        activePath: (pathname) => pathname.includes("/admin/companies"),
      },
      {
        href: "/admin/projects",
        label: "Projects",
        icon: Building,
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
        icon: List,
        activePath: (pathname) => pathname.includes("/admin/properties"),
      },
      {
        href: "/admin/prospecting/listings",
        label: "Listings Inbox",
        icon: Home,
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
        icon: FileText,
        activePath: (pathname) => pathname.includes("/admin/content/pages"),
      },
      {
        href: "/admin/content/posts",
        label: "Blog",
        icon: LayoutTemplate,
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
        icon: List,
        activePath: (pathname) => pathname.includes("/admin/site-settings/navigation"),
      },
      {
        href: "/admin/settings",
        label: "Settings",
        icon: Settings,
        activePath: (pathname) => pathname.includes("/admin/settings"),
      },
    ],
  },
]

function AdminNavIcon({ icon: Icon, active, variant }: { icon: LucideIcon; active: boolean; variant: "desktop" | "mobile" }) {
  if (variant === "mobile") {
    return <Icon className="mr-3 h-4 w-4 text-muted-foreground" />
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

function AdminNavLink({ item, variant }: { item: AdminNavItem; variant: "desktop" | "mobile" }) {
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

  return (
    <Link
      href={item.href}
      prefetch
      className={clsx(
        "flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50",
        active && "bg-gray-100 text-gray-900 hover:text-gray-900 dark:bg-gray-800 dark:text-gray-50 dark:hover:text-gray-50"
      )}
    >
      <AdminNavIcon icon={Icon} active={active} variant="desktop" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

export function AdminNavigationGroups({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  return (
    <nav className={clsx(variant === "mobile" ? "space-y-6" : "space-y-4 px-3 text-sm")}>
      {ADMIN_NAV_GROUPS.map((group, index) => (
        <div key={group.label || `primary-${index}`} className="space-y-1">
          {group.label && (
            <h4
              className={clsx(
                "px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                variant === "mobile" ? "mb-2 px-4" : "mb-1"
              )}
            >
              {group.label}
            </h4>
          )}
          {group.items.map((item) => (
            <AdminNavLink key={item.href} item={item} variant={variant} />
          ))}
        </div>
      ))}
    </nav>
  )
}
