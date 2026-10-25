"use client"

import Link from "next/link"
import { HamburgerMenuIcon } from "@radix-ui/react-icons"
import config from "@/config"
import ModeToggle from "@/components/mode-toggle"
import { AICostBadge } from "@/components/ai-cost-badge"
import { AdminNotificationBell } from "@/components/notifications/admin-notification-bell"
import { ProductSwitcher, type ProductKey } from "@/components/product-switcher"
import { TenantHeaderSelector } from "@/components/tenant-header-selector"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { UserProfile } from "@/components/user-profile"
import { AdminNavigationGroups } from "@/app/(main)/admin/_components/admin-navigation"
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button"
import { appIdentity } from "@/lib/branding/app-identity"
import { VIEWING_SESSION_KINDS, VIEWING_SESSION_MODES } from "@/lib/viewings/sessions/types"
import type { ProductShellConfig } from "./product-config"
import type { AppShellData } from "./types"

/** Fixed slot for the usage badge so loading, and switching products, never moves the header items. */
export const AI_USAGE_SLOT_CLASS = "hidden min-w-[13rem] justify-end sm:flex"

/**
 * The one application header for CRM and Studio in every app. Products differ only by
 * configuration (menu and product-switch targets); the items, order and sizes are identical.
 */
export function AppHeader({
  product,
  app,
  activeLocationId,
  locations,
  platformLoginLocations,
  canViewAiUsage,
  productConfig,
}: Pick<AppShellData, "app" | "activeLocationId" | "locations" | "platformLoginLocations" | "canViewAiUsage"> & {
  product: ProductKey
  productConfig: ProductShellConfig
}) {
  // Live Assist is an Estio feature; it is offered from either product there.
  const liveAssist = app === "estio"
  // Notifications and AI usage are scoped to the tenant shown in the selector.
  const tenantWidgets = Boolean(activeLocationId)

  return (
    <header data-app-header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-3 lg:h-[55px]">
      <Sheet>
        <SheetTrigger className="p-2 transition min-[1024px]:hidden" aria-label="Open menu">
          <HamburgerMenuIcon className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="flex w-[85vw] max-w-[320px] flex-col p-0">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle className="font-bold">
              <Link href={productConfig.homeHref}>{appIdentity(app).name}</Link>
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4">
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-2">
              <span className="text-sm font-medium text-foreground">Theme</span>
              <ModeToggle />
            </div>
            {liveAssist ? (
              <QuickAssistStartButton
                label="Start Live Assist session"
                mode={VIEWING_SESSION_MODES.assistantLiveTranslate}
                sessionKind={VIEWING_SESSION_KINDS.twoWayInterpreter}
                variant="default"
                size="sm"
                className="h-10 w-full justify-start gap-2 font-medium"
                icon="languages"
              />
            ) : null}
            <ProductSwitcher active={product} targets={productConfig.targets} />
            <AdminNavigationGroups variant="mobile" groups={productConfig.navGroups} />
          </div>
        </SheetContent>
      </Sheet>
      <TenantHeaderSelector app={app} product={product} activeLocationId={activeLocationId} locations={locations} platformLoginLocations={platformLoginLocations} />
      <div className="ml-auto flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
        {liveAssist ? (
          <div className="hidden sm:flex">
            <QuickAssistStartButton
              label="Live Assist"
              mode={VIEWING_SESSION_MODES.assistantLiveTranslate}
              sessionKind={VIEWING_SESSION_KINDS.twoWayInterpreter}
              variant="outline"
              size="sm"
              icon="languages"
            />
          </div>
        ) : null}
        {tenantWidgets ? <AdminNotificationBell /> : null}
        {tenantWidgets && canViewAiUsage ? (
          <div className={AI_USAGE_SLOT_CLASS}>
            <AICostBadge />
          </div>
        ) : null}
        {config?.auth?.enabled ? <UserProfile /> : null}
        <ModeToggle />
      </div>
    </header>
  )
}
