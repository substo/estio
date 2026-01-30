"use client"

import ModeToggle from '@/components/mode-toggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { UserProfile } from '@/components/user-profile'
import { AICostBadge } from '@/components/ai-cost-badge'
import config from '@/config'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { Home, Settings, List, FileText } from 'lucide-react'
import Link from 'next/link'
import { ReactNode } from 'react'
import { APP_NAME } from "@/components/app-logo"

export default function DashboardTopNav({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <header className="flex h-14 lg:h-[55px] items-center gap-4 border-b px-3 bg-background">
        <Sheet>
          <SheetTrigger className="min-[1024px]:hidden p-2 transition">
            <HamburgerMenuIcon />
            <Link href="/admin">
              <span className="sr-only">Home</span>
            </Link>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <Link href="/">
                <SheetTitle>{APP_NAME}</SheetTitle>
              </Link>
            </SheetHeader>
            <div className="flex flex-col space-y-3 mt-[1rem]">
              <SheetClose asChild>
                <Link href="/admin">
                  <Button variant="outline" className="w-full">
                    <Home className="mr-2 h-4 w-4" />
                    Overview
                  </Button>
                </Link>
              </SheetClose>
              <SheetClose asChild>
                <Link href="/admin/properties">
                  <Button variant="outline" className="w-full">
                    <List className="mr-2 h-4 w-4" />
                    Properties
                  </Button>
                </Link>
              </SheetClose>
              <SheetClose asChild>
                <Link href="/admin/contacts">
                  <Button variant="outline" className="w-full">
                    <FileText className="mr-2 h-4 w-4" />
                    Contacts
                  </Button>
                </Link>
              </SheetClose>
              <Separator className="my-3" />
              <SheetClose asChild>
                <Link href="/admin/settings">
                  <Button variant="outline" className="w-full">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Button>
                </Link>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
        <div className="flex justify-center items-center gap-2 ml-auto">
          <AICostBadge />
          {config?.auth?.enabled && <UserProfile />}
          <ModeToggle />
        </div>
      </header>
      {children}
    </div>
  )
}

