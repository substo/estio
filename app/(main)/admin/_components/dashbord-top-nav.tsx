"use client"

import ModeToggle from '@/components/mode-toggle'
import { AdminNotificationBell } from '@/components/notifications/admin-notification-bell'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { UserProfile } from '@/components/user-profile'
import { AICostBadge } from '@/components/ai-cost-badge'
import config from '@/config'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import Link from 'next/link'
import { ReactNode } from 'react'
import { APP_NAME } from "@/components/app-logo"
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button"
import { AdminNavigationGroups } from "./admin-navigation"
import { cn } from "@/lib/utils"
import { VIEWING_SESSION_KINDS, VIEWING_SESSION_MODES } from "@/lib/viewings/sessions/types"
import { ActiveLocationSwitcher } from "./active-location-switcher"
import { PlatformLocationLoginSwitcher } from "./platform-location-login-switcher"
import type { PlatformLocationLoginOption } from "@/lib/auth/platform-location-options"

export default function DashboardTopNav({ children, appSurface = false, activeLocation, availableLocations, platformLoginLocations, showPlatformAdministration }: {
  children: ReactNode
  appSurface?: boolean
  activeLocation: { id: string; name: string | null }
  availableLocations: Array<{ id: string; name: string | null }>
  platformLoginLocations: PlatformLocationLoginOption[] | null
  showPlatformAdministration: boolean
}) {
  return (
    <div
      data-admin-top-nav={appSurface ? "app-surface" : "default"}
      className={cn(
        "min-w-0 flex flex-col",
        appSurface && "h-full min-h-0 overflow-hidden"
      )}
    >
      <header className="flex h-14 lg:h-[55px] shrink-0 items-center gap-4 border-b px-3 bg-background">
        <Sheet>
          <SheetTrigger className="min-[1024px]:hidden p-2 transition">
            <HamburgerMenuIcon className="h-5 w-5" />
            <Link href="/admin">
              <span className="sr-only">Home</span>
            </Link>
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] max-w-[320px] p-0 flex flex-col">
            <SheetHeader className="p-4 border-b text-left">
              <Link href="/">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-bold">{APP_NAME}</span>
                </SheetTitle>
              </Link>
            </SheetHeader>
            
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
              <div className="mb-4 flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-2">
                <span className="text-sm font-medium text-foreground">Theme</span>
                <ModeToggle />
              </div>
              <div className="space-y-1">
                <QuickAssistStartButton
                  label="Start Quick Assist"
                  mode={VIEWING_SESSION_MODES.assistantLiveTranslate}
                  sessionKind={VIEWING_SESSION_KINDS.twoWayInterpreter}
                  variant="default"
                  size="sm"
                  className="w-full justify-start gap-2 h-10 mb-2 font-medium"
                  icon="languages"
                />
              </div>
              <AdminNavigationGroups variant="mobile" showPlatformAdministration={showPlatformAdministration} />
            </div>
          </SheetContent>
        </Sheet>
        {platformLoginLocations ? (
          <PlatformLocationLoginSwitcher activeLocationId={activeLocation.id} locations={platformLoginLocations} />
        ) : availableLocations.length > 1 ? (
          <ActiveLocationSwitcher activeLocationId={activeLocation.id} locations={availableLocations} />
        ) : null}
        <div className="ml-auto flex min-w-0 items-center justify-center gap-1.5 sm:gap-2">
          <div className="hidden sm:flex">
            <QuickAssistStartButton
              label="Quick Assist"
              mode={VIEWING_SESSION_MODES.assistantLiveTranslate}
              sessionKind={VIEWING_SESSION_KINDS.twoWayInterpreter}
              variant="outline"
              size="sm"
              icon="languages"
            />
          </div>
          <AdminNotificationBell />
          <div className="hidden sm:block">
            <AICostBadge />
          </div>
          {config?.auth?.enabled && <UserProfile />}
          <ModeToggle />
        </div>
      </header>
      {children}
    </div>
  )
}
