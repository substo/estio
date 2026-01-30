"use client"

import clsx from 'clsx'
import {
  Home,
  Settings,
  List,
  FileText,
  LayoutTemplate,
  Building,
  MessageSquare,
  Layers
} from "lucide-react"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppLogo } from "@/components/app-logo"



export default function DashboardSideBar({ logoUrl, lightUrl }: { logoUrl?: string, lightUrl?: string }) {
  const pathname = usePathname();

  const mainLinks = [
    {
      href: "/admin",
      label: "Overview",
      icon: <Home className="h-3 w-3" />,
      activePath: (pathname: string) => pathname === "/admin"
    },
    {
      href: `/admin/conversations`,
      label: "Conversations",
      icon: <MessageSquare className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/conversations`)
    },
    {
      href: `/admin/properties`,
      label: "Properties",
      icon: <List className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/properties`)
    },
    {
      href: `/admin/contacts`,
      label: "Contacts",
      icon: <FileText className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/contacts`)
    },
    {
      href: `/admin/companies`,
      label: "Companies",
      icon: <Building className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/companies`)
    },
    {
      href: `/admin/projects`,
      label: "Projects",
      icon: <Building className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/projects`)
    },
    {
      href: `/admin/content/pages`, // Directly link to pages list
      label: "Pages",
      icon: <FileText className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/content/pages`)
    },
    {
      href: `/admin/content/posts`,
      label: "Blog",
      icon: <LayoutTemplate className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/content/posts`)
    },
  ];

  const settingsLinks = [
    {
      href: `/admin/site-settings/navigation`,
      label: "Menus",
      icon: <List className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/site-settings/navigation`)
    },
    {
      href: `/admin/settings`,
      label: "Settings",
      icon: <Settings className="h-3 w-3" />,
      activePath: (pathname: string) => pathname.includes(`/admin/settings`)
    }
  ];

  return (
    <div className="lg:block hidden border-r h-full sticky top-0 h-screen bg-muted/40">
      <div className="flex h-full max-h-screen flex-col gap-2 ">
        <div className="flex h-[55px] items-center justify-center border-b px-3 w-full">
          <AppLogo size="sm" showName={true} url={logoUrl} lightUrl={lightUrl} />
        </div>
        <div className="flex-1 overflow-auto py-2 flex flex-col justify-between">
          <nav className="grid items-start px-4 text-sm font-medium">
            {mainLinks.map(({ href, label, icon, activePath }) => (
              <div key={href} className="flex flex-col gap-2">
                <Link
                  prefetch={true}
                  className={clsx("flex items-center gap-2 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50", {
                    "flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-gray-900 transition-all hover:text-gray-900 dark:bg-gray-800 dark:text-gray-50 dark:hover:text-gray-50": activePath(pathname)
                  })}
                  href={href}
                >
                  <div className="border rounded-lg dark:bg-black dark:border-gray-800 border-gray-400 p-1 bg-white">
                    {icon}
                  </div>
                  {label}
                </Link>
              </div>
            ))}
          </nav>
          <nav className="grid items-start px-4 text-sm font-medium mt-auto">
            {settingsLinks.map(({ href, label, icon, activePath }) => (
              <div key={href} className="flex flex-col gap-2">
                <Link
                  prefetch={true}
                  className={clsx("flex items-center gap-2 rounded-lg px-3 py-2 text-gray-500 transition-all hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-50", {
                    "flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-gray-900 transition-all hover:text-gray-900 dark:bg-gray-800 dark:text-gray-50 dark:hover:text-gray-50": activePath(pathname)
                  })}
                  href={href}
                >
                  <div className="border rounded-lg dark:bg-black dark:border-gray-800 border-gray-400 p-1 bg-white">
                    {icon}
                  </div>
                  {label}
                </Link>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
