"use client"

import { ReactNode, useEffect, useState } from "react"
import DashboardSideBar from "./dashboard-side-bar"
import DashboardTopNav from "./dashbord-top-nav"

const SIDEBAR_STORAGE_KEY = "admin-sidebar-collapsed"
const EXPANDED_SIDEBAR_WIDTH = "160px"
const COLLAPSED_SIDEBAR_WIDTH = "68px"

function setSidebarWidth(collapsed: boolean) {
  document.documentElement.style.setProperty(
    "--admin-sidebar-width",
    collapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH
  )
}

export function AdminSidebarPreferenceScript() {
  const script = `
    (function () {
      try {
        var collapsed = window.localStorage.getItem("${SIDEBAR_STORAGE_KEY}") === "true";
        document.documentElement.style.setProperty("--admin-sidebar-width", collapsed ? "${COLLAPSED_SIDEBAR_WIDTH}" : "${EXPANDED_SIDEBAR_WIDTH}");
      } catch {}
    })();
  `

  return <script dangerouslySetInnerHTML={{ __html: script }} />
}

export function AdminShellLayout({
  children,
  logoUrl,
  lightUrl,
}: {
  children: ReactNode
  logoUrl?: string
  lightUrl?: string
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
      const nextCollapsed = storedValue === "true"
      setSidebarCollapsed(nextCollapsed)
      setSidebarWidth(nextCollapsed)
    } catch {
      setSidebarWidth(false)
    }
  }, [])

  function handleSidebarCollapsedChange(nextCollapsed: boolean) {
    setSidebarCollapsed(nextCollapsed)
    setSidebarWidth(nextCollapsed)

    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextCollapsed))
    } catch {}
  }

  return (
    <div className="grid min-h-screen w-full lg:[grid-template-columns:var(--admin-sidebar-width,160px)_minmax(0,1fr)]">
      <DashboardSideBar
        collapsed={sidebarCollapsed}
        logoUrl={logoUrl}
        lightUrl={lightUrl}
        onCollapsedChange={handleSidebarCollapsedChange}
      />
      <DashboardTopNav>{children}</DashboardTopNav>
    </div>
  )
}
