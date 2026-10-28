import { studioRouteParams } from "@/lib/studio/route-context";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getStudioShellData } from "../_components/studio-shell-data";

export default async function StudioLocationLayout({ params, children }: { params: Promise<{  }>; children: ReactNode }) {
  const { locationId } = await studioRouteParams(params);
  const shell = await getStudioShellData({ locationId });
  if (!shell) notFound();
  return <AppShell product="studio" {...shell} key={locationId}>{children}</AppShell>;
}
