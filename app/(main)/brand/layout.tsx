import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { StudioShell } from "../studio/_components/studio-shell";
import { getStudioShellData } from "../studio/_components/studio-shell-data";

export const dynamic = "force-dynamic";

/** Brand pages (team, settings) exist on Substo only; Estio manages its team in the CRM. */
export default async function BrandLayout({ children }: { children: ReactNode }) {
  if (resolveHostBrand((await headers()).get("host"), getHostBrandConfig()) !== "substo") notFound();
  const shell = await getStudioShellData();
  if (!shell) notFound();
  return <StudioShell {...shell}>{children}</StudioShell>;
}

export async function generateMetadata() {
  return await getRequestAuthRealm() === "substo" ? { title: "Brand" } : {};
}
