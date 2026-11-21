import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StudioTenantProvider } from "@/app/(main)/studio/_components/studio-tenant-context";
import { requireSettingsContext } from "./_components/context";
import { visibleSettingsSections } from "./_components/sections";
import { getStudioShellData } from "@/app/(main)/studio/_components/studio-shell-data";
import { SettingsShell } from "./_components/settings-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

/** Settings shared by CRM and Studio: one Location, one section nav, and a way back to the product the person came from. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const { app, access, tenantHost } = await requireSettingsContext();
  const shell = await getStudioShellData();
  const content = access ? <StudioTenantProvider locationId={access.locationId}>{children}</StudioTenantProvider>
    : <main className="max-w-3xl space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-sm text-muted-foreground">Select a Location to view its settings.</p>
      <Button asChild><Link href={app === "substo" ? "/studio/select" : "/select-location"}>Select Location</Link></Button>
    </main>;
  if (!shell) return <div className="p-4">{content}</div>;
  return <Suspense>
    <SettingsShell shell={shell} tenantHost={tenantHost} sections={visibleSettingsSections(app, access?.role ?? null, tenantHost, Boolean(shell.impersonation))}>
      {content}
    </SettingsShell>
  </Suspense>;
}
