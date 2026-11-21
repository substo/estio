"use client"

import { useCrmRealm } from "./crm-realm"
import { isSubstoCrmPage } from "@/lib/auth/substo-crm-policy"
import { useId, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { LucideIcon } from "lucide-react"
import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  House,
  Inbox,
  LayoutDashboard,
  MessagesSquare,
  Newspaper,
  PanelsTopLeft,
  Radar,
  Radio,
  Palette,
  Rocket,
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
  formTarget?: { action: string; fields: Record<string, string> }
  setupPending?: boolean
  substoAdminOnly?: boolean
}

export type AdminNavGroup = {
  label?: string
  items: AdminNavItem[]
  disclosure?: { icon: LucideIcon; bottom?: boolean }
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
        href: "/admin/live-assist",
        label: "Live Assist",
        icon: Radio,
        activePath: (pathname) => pathname.startsWith("/admin/live-assist") || pathname.startsWith("/admin/viewings/sessions"),
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
    label: "Website",
    disclosure: { icon: PanelsTopLeft },
    items: [
      {
        href: "/admin/content/website",
        label: "Publishing",
        icon: Rocket,
        activePath: (pathname) => pathname === "/admin/content/website",
      },
      {
        href: "/admin/content/home",
        label: "Homepage",
        icon: House,
        activePath: (pathname) => pathname === "/admin/content/home",
      },
      {
        href: "/admin/content/pages",
        label: "Pages",
        icon: PanelsTopLeft,
        activePath: (pathname) => pathname.startsWith("/admin/content/pages"),
      },
      {
        href: "/admin/content/posts",
        label: "Blog",
        icon: Newspaper,
        activePath: (pathname) => pathname.startsWith("/admin/content/posts"),
      },
      {
        href: "/admin/content/website/navigation",
        label: "Menus",
        icon: SquareMenu,
        activePath: (pathname) => pathname === "/admin/content/website/navigation",
        substoAdminOnly: true,
      },
      {
        href: "/admin/content/website/appearance",
        label: "Appearance",
        icon: Palette,
        activePath: (pathname) => pathname === "/admin/content/website/appearance",
        substoAdminOnly: true,
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

  if (item.setupPending) {
    return (
      <div
        role="link"
        aria-disabled="true"
        aria-label={`${item.label} — setup pending`}
        title={`${item.label}: setup pending on Substo`}
        className={clsx("flex min-h-10 items-center rounded-lg text-sm text-muted-foreground opacity-60", collapsed ? "h-10 w-10 justify-center" : "gap-2 px-2.5 py-2")}
      >
        <AdminNavIcon icon={Icon} active={false} variant={variant} collapsed={collapsed} />
        <span className={clsx(collapsed ? "sr-only" : "truncate")}>{item.label}</span>
        {!collapsed && <span className="ml-auto shrink-0 text-[10px]">Setup pending</span>}
      </div>
    )
  }

  if (item.formTarget) {
    return <form action={item.formTarget.action} method="post">
      {Object.entries(item.formTarget.fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" aria-label={item.label} title={item.label} className={clsx("flex min-h-10 w-full items-center rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground", collapsed ? "justify-center" : "gap-2 px-2.5 py-2")}>
        <AdminNavIcon icon={Icon} active={active} variant={variant} collapsed={collapsed} />
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
      </button>
    </form>
  }

  if (variant === "mobile") {
    return (
      <SheetClose asChild>
        <Button asChild variant={active ? "secondary" : "ghost"} className="min-h-11 w-full justify-start font-normal">
          <Link href={item.href} prefetch aria-current={active ? "page" : undefined}>
            <AdminNavIcon icon={Icon} active={active} variant="mobile" />
            {item.label}
          </Link>
        </Button>
      </SheetClose>
    )
  }

  const desktopLink = (
    <Link
      href={item.href}
      prefetch
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
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

function NavDisclosure({ group, variant, compact }: {
  group: AdminNavGroup & { disclosure: NonNullable<AdminNavGroup["disclosure"]> }
  variant: "desktop" | "mobile"
  compact: boolean
}) {
  const pathname = usePathname()
  const active = group.items.some(item => item.activePath(pathname))
  const [manual, setManual] = useState<boolean | null>(null)
  const [hovering, setHovering] = useState(false)
  const [childFocused, setChildFocused] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const open = hovering || childFocused || (manual ?? active)
  const bottom = group.disclosure.bottom && variant === "desktop"

  return (
    <div
      className={clsx("flex", bottom ? "flex-col-reverse" : "flex-col")}
      onPointerEnter={event => {
        if (variant === "desktop" && event.pointerType === "mouse") setHovering(true)
      }}
      onPointerLeave={() => setHovering(false)}
      onKeyDown={event => {
        if (event.key !== "Escape" || !open) return
        event.stopPropagation()
        setManual(false)
        setHovering(false)
        setChildFocused(false)
        trigger.current?.focus()
      }}
    >
      <button
        type="button"
        ref={trigger}
        aria-expanded={open}
        aria-controls={id}
        title={compact ? group.label : undefined}
        className={clsx(
          "flex shrink-0 items-center rounded-lg text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          compact ? "h-10 w-10 justify-center" : "min-h-11 w-full gap-2 px-2.5 text-left",
          active && "bg-accent text-foreground"
        )}
        onClick={() => {
          setHovering(false)
          setManual(!(manual ?? active))
        }}
      >
        <AdminNavIcon icon={group.disclosure.icon} active={active} variant={variant} collapsed={compact} />
        <span className={compact ? "sr-only" : "truncate"}>{group.label}</span>
        {!compact && <ChevronDown aria-hidden="true" className={clsx("ml-auto size-4 shrink-0", open && "rotate-180")} />}
      </button>
      <div
        id={id}
        hidden={!open}
        className={clsx("space-y-1 py-1", !compact && "ml-3 border-l pl-2", group.disclosure.bottom && "max-h-[45dvh] overflow-y-auto")}
        onFocus={() => setChildFocused(true)}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setChildFocused(false)
        }}
      >
        {group.items.map(item => (
          <AdminNavLink key={item.href} item={item} variant={variant} collapsed={compact} />
        ))}
      </div>
    </div>
  )
}

export function AdminNavigationGroups({
  variant = "desktop",
  collapsed = false,
  groups = ADMIN_NAV_GROUPS,
  locationAdmin = true,
}: {
  variant?: "desktop" | "mobile"
  collapsed?: boolean
  /** Defaults to the CRM menu; Studio passes its own groups with the same look. */
  groups?: AdminNavGroup[]
  locationAdmin?: boolean
}) {
  const realm = useCrmRealm()
  const visibleGroups = groups === ADMIN_NAV_GROUPS
    ? groups.map((group) => ({
      ...group,
      items: group.items
        .filter(item => realm !== "substo" || !item.substoAdminOnly || locationAdmin)
        .map(item => realm === "substo" ? { ...item, setupPending: !isSubstoCrmPage(item.href) } : item),
    }))
    : groups
  const compact = variant === "desktop" && collapsed

  return (
    <TooltipProvider delayDuration={150}>
      <nav className={clsx(variant === "mobile" ? "space-y-6" : compact ? "space-y-3 px-3.5 text-sm" : "space-y-4 px-3 text-sm")}>
        {visibleGroups.map((group, index) => group.disclosure ? (
          <NavDisclosure key={group.label} group={{ ...group, disclosure: group.disclosure }} variant={variant} compact={compact} />
        ) : (
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
              <AdminNavLink key={`${item.label}:${item.href}`} item={item} variant={variant} collapsed={compact} />
            ))}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  )
}
