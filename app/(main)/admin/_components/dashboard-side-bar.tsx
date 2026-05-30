"use client"

import { AppLogo } from "@/components/app-logo"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { AdminNavigationGroups } from "./admin-navigation"
import { cn } from "@/lib/utils"

export default function DashboardSideBar({
  collapsed,
  logoUrl,
  lightUrl,
  onCollapsedChange,
}: {
  collapsed: boolean
  logoUrl?: string
  lightUrl?: string
  onCollapsedChange: (collapsed: boolean) => void
}) {
  const ToggleIcon = collapsed ? ChevronRight : ChevronLeft
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar"

  return (
    <div className="relative hidden h-screen border-r bg-muted/40 lg:sticky lg:top-0 lg:block">
      <div className="flex h-full max-h-screen flex-col gap-2 overflow-hidden">
        <div className="flex h-[55px] w-full items-center justify-center border-b px-2">
          <AppLogo
            size="sm"
            showName={true}
            url={logoUrl}
            lightUrl={lightUrl}
            iconOnly={collapsed}
            className={collapsed ? "justify-center" : "min-w-0"}
          />
        </div>
        <div className="flex-1 overflow-auto py-3">
          <AdminNavigationGroups collapsed={collapsed} />
        </div>
      </div>
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              className={cn(
                "absolute right-0 top-1/2 z-30 h-7 w-6 -translate-y-1/2 translate-x-1/2 rounded-full border bg-background p-0 shadow-sm",
                "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
              onClick={() => onCollapsedChange(!collapsed)}
            >
              <ToggleIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{toggleLabel}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
