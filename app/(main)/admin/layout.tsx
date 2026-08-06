import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminShellLayout, AdminSidebarPreferenceScript } from "./_components/admin-shell-layout";
import { AdminContentFrame } from "./_components/admin-content-frame";
import { OnboardingWrapper } from "@/components/onboarding-wrapper";
import { AnalyticsTracker } from "@/components/analytics/analytics-tracker";
import { LocationPresenceTracker } from "./_components/location-presence-tracker";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import db from "@/lib/db";
import { activateCurrentImpersonation } from "@/lib/auth/impersonation";
import { auth } from "@clerk/nextjs/server";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { listPlatformLocationLoginOptions } from "@/lib/auth/platform-location-options";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const platformAdmin = await getPlatformAdminContext();
  const resolution = await resolveActiveLocation();
  if (resolution.status === "unauthenticated") redirect("/sign-in");
  if (resolution.status === "selection_required") redirect("/select-location");

  if (resolution.status !== "authorized" || !resolution.location || !resolution.user) {
    if ((await auth()).actor) redirect("/support-access-invalid");
    const hostname = (await headers()).get("host") || "";
    const isSystemDomain = ["localhost", "estio.co"].includes(hostname.replace(":3000", ""));
    redirect(isSystemDomain ? "/" : "/favorites");
  }

  const { location, user } = resolution;
  const impersonation = (await auth()).actor ? await activateCurrentImpersonation() : null;
  const needsOnboarding = !user.firstName || !user.lastName;
  const [siteConfig, platformLoginLocations] = await Promise.all([
    db.siteConfig.findUnique({ where: { locationId: location.id }, select: { theme: true } }),
    platformAdmin ? listPlatformLocationLoginOptions(platformAdmin.internalUserId) : Promise.resolve(null),
  ]);
  const theme = siteConfig?.theme as { logo?: { url?: string; lightUrl?: string } } | null;

  return (
    <>
      <AdminSidebarPreferenceScript />
      <LocationPresenceTracker />
      <AdminShellLayout
        logoUrl={theme?.logo?.url}
        lightUrl={theme?.logo?.lightUrl}
        activeLocation={{ id: location.id, name: location.name }}
        availableLocations={resolution.availableLocations}
        platformLoginLocations={platformLoginLocations}
        showPlatformAdministration={Boolean(platformAdmin)}
        impersonation={impersonation ? {
          targetName: impersonation.targetName,
          targetEmail: impersonation.targetEmail,
          locationName: impersonation.locationName,
          sessionId: impersonation.sessionId,
        } : null}
      >
        <AdminContentFrame>
          <Suspense fallback={null}><AnalyticsTracker eventName="admin_page_view" /></Suspense>
          {needsOnboarding ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4">
              <div className="text-center">
                <h2 className="text-2xl font-semibold">Welcome to the Team!</h2>
                <p className="mt-2 text-muted-foreground">Please complete your profile setup to continue accessing the dashboard.</p>
              </div>
            </div>
          ) : children}
        </AdminContentFrame>
      </AdminShellLayout>
      <OnboardingWrapper
        needsOnboarding={needsOnboarding}
        existingData={{ firstName: user.firstName || "", lastName: user.lastName || "", timeZone: user.timeZone || "" }}
      />
    </>
  );
}
