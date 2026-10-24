"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignedIn, SignedOut, SignOutButton, UserButton } from "@clerk/nextjs";
import config from "@/config";
import { useBrandExperience } from "@/components/wrapper/brand-experience";
import { ProductSwitcher } from "@/components/product-switcher";
import { openEstioStudioBusinessAction } from "../actions";

export function StudioHeader() {
  const brand = useBrandExperience();
  const pathname = usePathname();
  const workspaceId = pathname.match(/^\/studio\/workspace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i)?.[1];
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/studio" className="font-semibold tracking-tight">{brand === "substo" ? "Substo Studio" : "Estio Studio"}</Link>
          {/* Substo has no CRM yet, so it gets no CRM target and the switch stays hidden there. */}
          {brand === "estio" ? (
            <ProductSwitcher
              active="studio"
              className="w-44"
              targets={{
                crm: workspaceId ? { action: openEstioStudioBusinessAction.bind(null, workspaceId) } : { href: "/admin" },
                studio: { href: "/studio" },
              }}
            />
          ) : null}
        </div>
        <nav aria-label="Studio navigation" className="flex items-center gap-4 text-sm">
          <Link href="/account/connections" className="text-muted-foreground hover:text-foreground">My connections</Link>
          <Link href="/studio" className="text-muted-foreground hover:text-foreground">Workspaces</Link>
          {workspaceId ? <Link href={`/studio/workspace/${workspaceId}/youtube`} className="text-muted-foreground hover:text-foreground">Discovery</Link> : null}
          {workspaceId ? <Link href={`/studio/workspace/${workspaceId}/knowledge`} className="text-muted-foreground hover:text-foreground">Knowledge</Link> : null}
          {workspaceId ? <Link href={`/studio/workspace/${workspaceId}/schedules`} className="text-muted-foreground hover:text-foreground">Schedules</Link> : null}
          {workspaceId ? <Link href={`/studio/workspace/${workspaceId}/jobs`} className="text-muted-foreground hover:text-foreground">Jobs</Link> : null}
          {workspaceId ? <Link href={`/studio/workspace/${workspaceId}/settings/ai`} className="text-muted-foreground hover:text-foreground">AI settings</Link> : null}
          {config.auth.enabled ? (
            <>
              <SignedIn>
                <UserButton afterSignOutUrl="/sign-in" />
                <SignOutButton redirectUrl="/sign-in"><button type="button" className="text-muted-foreground hover:text-foreground">Sign out</button></SignOutButton>
              </SignedIn>
              <SignedOut><Link href="/sign-in" className="text-primary">Sign in</Link></SignedOut>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
