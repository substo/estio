"use client"

import { AppLogo } from "@/components/app-logo"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
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
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar"

  return (
    <div className="hidden h-screen overflow-hidden border-r bg-muted/40 lg:sticky lg:top-0 lg:block">
      <div className="flex h-full max-h-screen flex-col gap-2 ">
        <div
          className={cn(
            "relative flex h-[55px] w-full items-center justify-between border-b px-2",
            collapsed ? "gap-1" : "gap-2"
          )}
        >
          <AppLogo
            size="sm"
            showName={true}
            url={logoUrl}
            lightUrl={lightUrl}
            iconOnly={collapsed}
            className={collapsed ? "justify-center" : "min-w-0"}
          />
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={toggleLabel}
                  aria-expanded={!collapsed}
                  className={cn("h-9 w-9 shrink-0", collapsed && "h-8 w-8")}
                  onClick={() => onCollapsedChange(!collapsed)}
                >
                  <ToggleIcon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{toggleLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex-1 overflow-auto py-3">
          <AdminNavigationGroups collapsed={collapsed} />
        </div>
      </div>
    </div>
  )
}
