"use client"

import { useEffect, useState } from "react"

const SIDEBAR_STORAGE_KEY = "admin-sidebar-collapsed"
const EXPANDED_SIDEBAR_WIDTH = "160px"
const COLLAPSED_SIDEBAR_WIDTH = "68px"

function setSidebarWidth(collapsed: boolean) {
  document.documentElement.style.setProperty(
    "--admin-sidebar-width",
    collapsed ? COLLAPSED_SIDEBAR_WIDTH : EXPANDED_SIDEBAR_WIDTH
  )
}

/** Applies the stored sidebar width before paint so CRM and Studio open at the same width. */
export function SidebarPreferenceScript() {
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

/** Sidebar collapse state shared by every product (stored once per browser). */
export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    try {
      const nextCollapsed = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true"
      setSidebarCollapsed(nextCollapsed)
      setSidebarWidth(nextCollapsed)
    } catch {
      setSidebarWidth(false)
    }
  }, [])

  function update(nextCollapsed: boolean) {
    setSidebarCollapsed(nextCollapsed)
    setSidebarWidth(nextCollapsed)
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(nextCollapsed))
    } catch {}
  }

  return [sidebarCollapsed, update]
}
