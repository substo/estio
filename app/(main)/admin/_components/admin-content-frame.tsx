"use client"

import { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

function useAdminAppSurface() {
  return usePathname() === "/admin/conversations"
}

export function AdminContentFrame({ children }: { children: ReactNode }) {
  const appSurface = useAdminAppSurface()

  return (
    <main
      data-admin-content-frame={appSurface ? "app-surface" : "default"}
      className={cn(
        "min-w-0 flex flex-col gap-4 p-4 lg:gap-6",
        appSurface && "flex-1 min-h-0 overflow-hidden gap-0 p-0 lg:gap-0"
      )}
    >
      {children}
    </main>
  )
}
