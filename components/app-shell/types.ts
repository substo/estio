import type { ImpersonationBannerData } from "@/app/(main)/admin/_components/impersonation-banner"
import type { PlatformLocationLoginOption } from "@/lib/auth/platform-location-options"
import type { TenantOption } from "@/components/tenant-selector"

export type ShellApp = "estio" | "substo"

/** Everything the one application shell needs, resolved once on the server from the active tenant. */
export type AppShellData = {
  app: ShellApp
  /** The tenant (Prisma Location) shown in the header; header widgets act on this same tenant. */
  activeLocationId: string | null
  locations: TenantOption[]
  platformLoginLocations: PlatformLocationLoginOption[] | null
  impersonation: ImpersonationBannerData | null
  logoUrl?: string
  lightUrl?: string
  /** Location-wide AI spend is admin-only; known up front so its header slot never pops in or out. */
  canViewAiUsage: boolean
  /** Private Studio storage key for the active tenant (never a selection input). */
  studioLocationId: string | null
}
