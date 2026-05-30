"use client"

import { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useAdminLayoutPolicy } from "./admin-layout-policy"

export function AdminContentFrame({ children }: { children: ReactNode }) {
  const { appSurface } = useAdminLayoutPolicy()

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
