"use client"

import { createContext, ReactNode, useContext } from "react"
import { usePathname } from "next/navigation"

export const ADMIN_APP_SURFACE_PATHS = [
  "/admin/conversations",
  "/admin/prospecting",
] as const

export function isAdminAppSurfacePath(pathname: string): boolean {
  return ADMIN_APP_SURFACE_PATHS.some((path) => pathname === path)
}

type AdminLayoutPolicy = {
  appSurface: boolean
}

const AdminLayoutPolicyContext = createContext<AdminLayoutPolicy>({
  appSurface: false,
})

export function useAdminLayoutPolicy(): AdminLayoutPolicy {
  return useContext(AdminLayoutPolicyContext)
}

export function useResolvedAdminLayoutPolicy(): AdminLayoutPolicy {
  const pathname = usePathname()

  return {
    appSurface: isAdminAppSurfacePath(pathname),
  }
}

export function AdminLayoutPolicyProvider({
  children,
  value,
}: {
  children: ReactNode
  value: AdminLayoutPolicy
}) {
  return (
    <AdminLayoutPolicyContext.Provider value={value}>
      {children}
    </AdminLayoutPolicyContext.Provider>
  )
}
