import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { StudioShell } from "../../_components/studio-shell";
import { getStudioShellData } from "../../_components/studio-shell-data";

export default async function WorkspaceLayout({ params, children }: { params: Promise<{ workspaceId: string }>; children: ReactNode }) {
  const { workspaceId } = await params;
  const shell = await getStudioShellData({ workspaceId });
  if (!shell) notFound();
  return <StudioShell {...shell} key={workspaceId}>{children}</StudioShell>;
}
