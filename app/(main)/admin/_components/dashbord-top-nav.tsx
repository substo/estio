"use client"

import ModeToggle from '@/components/mode-toggle'
import { AdminNotificationBell } from '@/components/notifications/admin-notification-bell'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { UserProfile } from '@/components/user-profile'
import { AICostBadge } from '@/components/ai-cost-badge'
import config from '@/config'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { Home, Settings, List, FileText, MessageSquare, Building, LayoutTemplate, Layers, Languages, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { ReactNode } from 'react'
import { APP_NAME } from "@/components/app-logo"
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button"

// A helper for rendering grouped nav items neatly
const NavItem = ({ href, icon: Icon, label }: { href: string, icon: any, label: string }) => (
  <SheetClose asChild>
    <Link href={href}>
      <Button variant="ghost" className="w-full justify-start font-normal h-10">
        <Icon className="mr-3 h-4 w-4 text-muted-foreground" />
        {label}
      </Button>
    </Link>
  </SheetClose>
);

export default function DashboardTopNav({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 flex flex-col">
      <header className="flex h-14 lg:h-[55px] items-center gap-4 border-b px-3 bg-background">
        <Sheet>
          <SheetTrigger className="min-[1024px]:hidden p-2 transition">
            <HamburgerMenuIcon className="h-5 w-5" />
            <Link href="/admin">
              <span className="sr-only">Home</span>
            </Link>
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] max-w-[320px] p-0 flex flex-col">
            <SheetHeader className="p-4 border-b text-left">
              <Link href="/">
                <SheetTitle className="flex items-center gap-2">
                  <span className="font-bold">{APP_NAME}</span>
                </SheetTitle>
              </Link>
            </SheetHeader>
            
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6">
              
              <div className="space-y-1">
                <QuickAssistStartButton label="Start Quick Assist" variant="default" size="sm" className="w-full justify-start gap-2 h-10 mb-2 font-medium" />
                <NavItem href="/admin" icon={Home} label="Overview" />
                <NavItem href="/admin/conversations" icon={MessageSquare} label="Conversations" />
                <NavItem href="/admin/viewings/sessions" icon={Languages} label="Quick Assist Sessions" />
              </div>

              <div className="space-y-1">
                <h4 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">CRM</h4>
                <NavItem href="/admin/contacts" icon={FileText} label="Contacts" />
                <NavItem href="/admin/prospecting" icon={Layers} label="Prospects (People)" />
                <NavItem href="/admin/companies" icon={Building} label="Companies" />
                <NavItem href="/admin/projects" icon={Building} label="Projects" />
              </div>

              <div className="space-y-1">
                <h4 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Listings</h4>
                <NavItem href="/admin/properties" icon={List} label="Properties" />
                <NavItem href="/admin/prospecting/listings" icon={Home} label="Listings Inbox" />
              </div>

              <div className="space-y-1">
                <h4 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Content</h4>
                <NavItem href="/admin/content/pages" icon={FileText} label="Pages" />
                <NavItem href="/admin/content/posts" icon={LayoutTemplate} label="Blog" />
              </div>

              <div className="space-y-1">
                <h4 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">System</h4>
                <NavItem href="/admin/site-settings/navigation" icon={List} label="Menus" />
                <NavItem href="/admin/settings" icon={Settings} label="Settings" />
              </div>
              
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex justify-center items-center gap-2 ml-auto">
          <div className="hidden sm:flex">
            <QuickAssistStartButton label="Quick Assist" variant="outline" size="sm" />
          </div>
          <AdminNotificationBell />
          <AICostBadge />
          {config?.auth?.enabled && <UserProfile />}
          <ModeToggle />
        </div>
      </header>
      {children}
    </div>
  )
}
