import { studioRouteParams } from "@/lib/studio/route-context";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getStudioShellData } from "../_components/studio-shell-data";

export default async function WorkspaceLayout({ params, children }: { params: Promise<{  }>; children: ReactNode }) {
  const { workspaceId } = await studioRouteParams(params);
  const shell = await getStudioShellData({ workspaceId });
  if (!shell) notFound();
  return <AppShell product="studio" {...shell} key={workspaceId}>{children}</AppShell>;
}
