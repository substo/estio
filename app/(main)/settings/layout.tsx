import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireSettingsContext } from "./_components/context";
import { SettingsBackLink, SettingsNav } from "./_components/settings-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/** Settings shared by CRM and Studio: one Location, one section nav, and a way back to the product the person came from. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { app, access } = await requireSettingsContext();
  return <div className="min-h-screen bg-background">
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6">
        <Suspense fallback={null}><SettingsBackLink fallback={app === "substo" ? "studio" : "crm"} /></Suspense>
        {access ? <p className="text-sm text-muted-foreground">Settings for <span className="font-medium text-foreground">{access.locationName}</span></p> : null}
      </div>
    </header>
    {access ? <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row md:px-6">
      <aside className="md:w-48 md:shrink-0"><SettingsNav /></aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div> : <main className="mx-auto max-w-6xl space-y-3 px-4 py-6 md:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-muted-foreground">Select a Location to view its settings.</p>
      <Button asChild><Link href={app === "substo" ? "/studio/select" : "/select-location"}>Select Location</Link></Button>
    </main>}
  </div>;
}
