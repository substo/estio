"use client"

import { AppLogo } from "@/components/app-logo"
import { AdminNavigationGroups } from "./admin-navigation"

export default function DashboardSideBar({ logoUrl, lightUrl }: { logoUrl?: string, lightUrl?: string }) {
  return (
    <div className="hidden h-screen border-r bg-muted/40 lg:sticky lg:top-0 lg:block">
      <div className="flex h-full max-h-screen flex-col gap-2 ">
        <div className="flex h-[55px] items-center justify-center border-b px-3 w-full">
          <AppLogo size="sm" showName={true} url={logoUrl} lightUrl={lightUrl} />
        </div>
        <div className="flex-1 overflow-auto py-3">
          <AdminNavigationGroups />
        </div>
      </div>
    </div>
  )
}
