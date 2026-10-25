import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import type { ReactNode } from "react";
import { StudioShell } from "./_components/studio-shell";
import { getStudioShellData } from "./_components/studio-shell-data";

export default async function StudioLayout({ children }: { children: ReactNode }) {
  const shell = await getStudioShellData();
  if (!shell) return <div className="min-h-screen bg-background text-foreground">{children}</div>;
  return <StudioShell {...shell}>{children}</StudioShell>;
}

export async function generateMetadata() {
  return await getRequestAuthRealm() === "substo" ? { title: "Studio" } : {};
}
