import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getAppShellData } from "@/components/app-shell/app-shell-data";
import { AdminContentFrame } from "./_components/admin-content-frame";
import { OnboardingWrapper } from "@/components/onboarding-wrapper";
import { AnalyticsTracker } from "@/components/analytics/analytics-tracker";
import { LocationPresenceTracker } from "./_components/location-presence-tracker";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { activateCurrentImpersonation } from "@/lib/auth/impersonation";
import { auth } from "@clerk/nextjs/server";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const realm = await getRequestAuthRealm();
  if (realm === "substo") {
    // Direct CRM entry also performs first-sign-in/invitation setup.
    const { prepareCurrentSubstoUser } = await import("@/lib/locations/substo-locations");
    await prepareCurrentSubstoUser();
  }
  const resolution = await resolveActiveLocation();
  if (resolution.status === "unauthenticated") redirect(realm === "substo" ? "/sign-in?redirect_url=%2Fadmin" : "/sign-in");
  if (resolution.status === "selection_required") redirect("/select-location");

  if (resolution.status !== "authorized" || !resolution.location || !resolution.user) {
    if ((await auth()).actor) redirect("/support-access-invalid");
    if (realm === "substo") redirect("/studio/select?choose=1");
    const hostname = (await headers()).get("host") || "";
    const isSystemDomain = ["localhost", "estio.co"].includes(hostname.replace(":3000", ""));
    redirect(isSystemDomain ? "/" : "/favorites");
  }

  const { user } = resolution;
  const impersonation = (await auth()).actor ? await activateCurrentImpersonation() : null;
  const needsOnboarding = !user.firstName || !user.lastName;
  const shell = await getAppShellData({
    app: realm,
    resolution,
    workspaceId: null,
    impersonation: impersonation ? {
      targetName: impersonation.targetName,
      targetEmail: impersonation.targetEmail,
      locationName: impersonation.locationName,
      sessionId: impersonation.sessionId,
    } : null,
  });

  return (
    <>
      <LocationPresenceTracker />
      <AppShell product="crm" {...shell}>
        <AdminContentFrame>
          {realm === "estio" ? <Suspense fallback={null}><AnalyticsTracker eventName="admin_page_view" /></Suspense> : null}
          {needsOnboarding ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4">
              <div className="text-center">
                <h2 className="text-2xl font-semibold">Welcome to the Team!</h2>
                <p className="mt-2 text-muted-foreground">Please complete your profile setup to continue accessing the dashboard.</p>
              </div>
            </div>
          ) : children}
        </AdminContentFrame>
      </AppShell>
      <OnboardingWrapper
        needsOnboarding={needsOnboarding}
        existingData={{ firstName: user.firstName || "", lastName: user.lastName || "", timeZone: user.timeZone || "" }}
      />
    </>
  );
}

export async function generateMetadata() {
  return await getRequestAuthRealm() === "substo" ? { title: "CRM" } : {};
}
