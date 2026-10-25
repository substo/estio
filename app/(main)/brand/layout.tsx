import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";

export const dynamic = "force-dynamic";

/** Brand pages (team, settings) exist on Substo only; Estio manages its team in the CRM. */
export default async function BrandLayout({ children }: { children: ReactNode }) {
  if (resolveHostBrand((await headers()).get("host"), getHostBrandConfig()) !== "substo") notFound();
  return children;
}

export async function generateMetadata() {
  return await getRequestAuthRealm() === "substo" ? { title: "Brand" } : {};
}
