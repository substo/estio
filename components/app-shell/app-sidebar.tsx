"use client"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Collapsible sidebar of the one application shell; contents come from the product configuration. */
export function AppSidebar({
  collapsed,
  appSurface = false,
  onCollapsedChange,
  logo,
  switcher,
  navigation,
}: {
  collapsed: boolean
  appSurface?: boolean
  onCollapsedChange: (collapsed: boolean) => void
  logo: ReactNode
  switcher: ReactNode
  navigation: ReactNode
}) {
  const ToggleIcon = collapsed ? ChevronRight : ChevronLeft
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar"

  return (
    <div
      className={cn(
        "relative hidden border-r bg-muted/40 lg:sticky lg:top-0 lg:block",
        appSurface ? "h-dvh" : "h-screen"
      )}
    >
      <div className="flex h-full max-h-screen flex-col gap-2 overflow-hidden">
        <div className="flex h-[55px] w-full items-center justify-center border-b px-2">
          {logo}
        </div>
        {switcher}
        <div className="flex-1 overflow-auto py-1">
          {navigation}
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
