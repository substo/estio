import { studioRouteParams } from "@/lib/studio/route-context";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { isStudioProviderUnavailable, studioProviderRestricted } from "@/lib/studio/rest";
import { getStudioShellData } from "../_components/studio-shell-data";
import { StudioUnavailable } from "../_components/studio-unavailable";

export default async function WorkspaceLayout({ params, children }: { params: Promise<{  }>; children: ReactNode }) {
  // While Studio's database provider is restricted, pages are not rendered at all.
  if (!studioProviderRestricted()) {
    try {
      const { workspaceId } = await studioRouteParams(params);
      const shell = await getStudioShellData({ workspaceId });
      if (!shell) notFound();
      return <AppShell product="studio" {...shell} key={workspaceId}>{children}</AppShell>;
    } catch (error) {
      if (!isStudioProviderUnavailable(error)) throw error;
    }
  }
  const shell = await getStudioShellData();
  if (!shell) notFound();
  return <AppShell product="studio" {...shell}><StudioUnavailable /></AppShell>;
}
