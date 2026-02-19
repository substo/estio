import { ReactNode } from "react"
import DashboardSideBar from "./_components/dashboard-side-bar"
import DashboardTopNav from "./_components/dashbord-top-nav"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { OnboardingWrapper } from "@/components/onboarding-wrapper"

import db from "@/lib/db"

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  console.log('[DashboardLayout] START - Layout rendering');
  console.time('[DashboardLayout] Total Time');

  // Use auth() (JWT-local, zero Clerk API calls) instead of currentUser() (Backend API call)
  console.time('[DashboardLayout] auth()');
  let userId: string | null = null;
  try {
    const authResult = await auth();
    userId = authResult.userId;
  } catch (e: any) {
    if (e?.status === 429) {
      console.warn('[DashboardLayout] Clerk rate limited (429). Showing error.');
      return (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Service Temporarily Busy</h2>
            <p className="text-muted-foreground">Authentication service is rate-limited. Please wait a moment and refresh the page.</p>
          </div>
        </div>
      );
    }
    throw e;
  }
  console.timeEnd('[DashboardLayout] auth()');

  if (!userId) {
    console.log('[DashboardLayout] No user found via auth()');
    redirect('/sign-in');
  }

  console.log(`[DashboardLayout] User: ${userId}`);

  // Look up user from local DB (no Clerk API call)
  console.time('[DashboardLayout] db.user.findUnique');
  const userWithLocations = await db.user.findUnique({
    where: { clerkId: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      locations: {
        take: 1,
        select: { id: true }
      }
    }
  });
  console.timeEnd('[DashboardLayout] db.user.findUnique');

  if (!userWithLocations) {
    // User exists in Clerk but not in local DB — this can happen if webhook hasn't fired yet.
    // The ensureUserExists() call from sign-up should have created them, but as a safety net:
    console.log('[DashboardLayout] User not found in local DB. Redirecting to sign-in.');
    redirect('/sign-in');
  }

  console.log(`[DashboardLayout] Local User ID: ${userWithLocations.id}, Locations: ${userWithLocations.locations?.length || 0}`);

  if (!userWithLocations.locations?.length) {
    // User has no admin access - redirect to appropriate page
    const headersList = await headers();
    const hostname = headersList.get('host') || '';
    const isSystemDomain = ['localhost:3000', 'estio.co', 'localhost'].includes(hostname.replace(':3000', ''));

    if (isSystemDomain) {
      redirect('/');
    } else {
      redirect('/favorites');
    }
  }

  // Profile data already fetched in the initial query above
  const needsOnboarding = !userWithLocations.firstName || !userWithLocations.lastName;

  // Fetch site config to get logo
  console.time('[DashboardLayout] db.siteConfig.findFirst');
  const siteConfig = await db.siteConfig.findFirst({
    select: { theme: true }
  });
  console.timeEnd('[DashboardLayout] db.siteConfig.findFirst');
  console.timeEnd('[DashboardLayout] Total Time');
  console.log('[DashboardLayout] END - All data fetched');

  // Cast theme to any to access logo safely
  const theme = siteConfig?.theme as any;
  const logoUrl = theme?.logo?.url;
  const lightUrl = theme?.logo?.lightUrl;

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-[160px_minmax(0,1fr)]">
      <DashboardSideBar logoUrl={logoUrl} lightUrl={lightUrl} />
      <DashboardTopNav>
        <main className="flex flex-col gap-4 p-4 lg:gap-6">
          {needsOnboarding ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
              <div className="text-center">
                <h2 className="text-2xl font-semibold">Welcome to the Team!</h2>
                <p className="text-muted-foreground mt-2">Please complete your profile setup to continue accessing the dashboard.</p>
              </div>
              {/* The OnboardingWrapper will show the modal over this */}
            </div>
          ) : (
            children
          )}
        </main>
      </DashboardTopNav>

      {/* Onboarding Modal */}
      <OnboardingWrapper
        needsOnboarding={needsOnboarding}
        existingData={{
          firstName: userWithLocations.firstName || '',
          lastName: userWithLocations.lastName || '',
          phone: userWithLocations.phone || ''
        }}
      />
    </div>
  )
}
