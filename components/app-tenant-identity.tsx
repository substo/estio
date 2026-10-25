"use client";

import type { ReactNode } from "react";
import { AppLogo } from "@/components/app-logo";

export function AppTenantIdentity({ app, homeHref = "/admin", children }: { app: "estio" | "substo"; homeHref?: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-center gap-2 sm:gap-3" aria-label={`${app === "substo" ? "Substo" : "Estio"} tenant`}>
    <AppLogo app={app} href={homeHref} size="sm" showName className="shrink-0 max-w-[5rem] sm:max-w-none" />
    <span className="h-5 shrink-0 border-l" aria-hidden="true" />
    {children}
  </div>;
}
