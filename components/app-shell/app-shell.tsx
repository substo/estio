"use client"

import type { ReactNode } from "react"
import { AppLogo } from "@/components/app-logo"
import { ProductSwitcher, type ProductKey } from "@/components/product-switcher"
import { cn } from "@/lib/utils"
import { CrmRealmProvider } from "@/app/(main)/admin/_components/crm-realm"
import { AdminNavigationGroups } from "@/app/(main)/admin/_components/admin-navigation"
import { AdminLayoutPolicyProvider, useResolvedAdminLayoutPolicy } from "@/app/(main)/admin/_components/admin-layout-policy"
import { ImpersonationBanner } from "@/app/(main)/admin/_components/impersonation-banner"
import { StudioTenantProvider } from "@/app/(main)/studio/_components/studio-tenant-context"
import { TenantSessionGuard } from "@/app/(main)/studio/_components/tenant-session-guard"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./app-sidebar"
import { productShellConfig } from "./product-config"
import { SidebarPreferenceScript, useSidebarCollapsed } from "./sidebar-preference"
import type { AppShellData } from "./types"

/**
 * The one application shell (sidebar + header) for CRM, Studio and brand pages in
 * both apps. Products only supply configuration; the frame itself is identical, so
 * switching product never changes the header.
 */
export function AppShell({ product, children, ...shell }: AppShellData & { product: ProductKey; children: ReactNode }) {
  const { app, activeLocationId, studioLocationId } = shell
  const [collapsed, setCollapsed] = useSidebarCollapsed()
  const layoutPolicy = useResolvedAdminLayoutPolicy()
  const { appSurface } = layoutPolicy
  const productConfig = productShellConfig(app, product, { locationId: activeLocationId, studioLocationId })

  return (
    <CrmRealmProvider value={app}>
      <SidebarPreferenceScript />
      {shell.impersonation ? <ImpersonationBanner context={shell.impersonation} /> : null}
      <div
        data-app-shell={appSurface ? "app-surface" : "default"}
        className={cn(
          "grid w-full lg:[grid-template-columns:var(--admin-sidebar-width,160px)_minmax(0,1fr)]",
          appSurface ? "h-dvh overflow-hidden" : "min-h-screen"
        )}
      >
        <AdminLayoutPolicyProvider value={layoutPolicy}>
          <AppSidebar
            collapsed={collapsed}
            appSurface={appSurface}
            onCollapsedChange={setCollapsed}
            logo={
              <AppLogo
                app={app}
                href={productConfig.homeHref}
                size="sm"
                showName
                url={shell.logoUrl}
                lightUrl={shell.lightUrl}
                iconOnly={collapsed}
                className={collapsed ? "justify-center" : "min-w-0"}
              />
            }
            switcher={<ProductSwitcher active={product} compact={collapsed} className={collapsed ? "mx-3.5" : "mx-3"} targets={productConfig.targets} />}
            navigation={<AdminNavigationGroups collapsed={collapsed} groups={productConfig.navGroups} />}
          />
          <div className={cn("flex min-w-0 flex-col", appSurface && "h-full min-h-0 overflow-hidden")}>
            <AppHeader
              product={product}
              app={app}
              activeLocationId={activeLocationId}
              locations={shell.locations}
              platformLoginLocations={shell.platformLoginLocations}
              canViewAiUsage={shell.canViewAiUsage}
              productConfig={productConfig}
            />
            {product === "studio" ? (
              <StudioTenantProvider locationId={activeLocationId}>
                <TenantSessionGuard locationId={activeLocationId} />
                {children}
              </StudioTenantProvider>
            ) : children}
          </div>
        </AdminLayoutPolicyProvider>
      </div>
    </CrmRealmProvider>
  )
}
