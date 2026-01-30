import { ReactNode } from "react"
import DashboardSideBar from "./_components/dashboard-side-bar"
import DashboardTopNav from "./_components/dashbord-top-nav"
import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { ensureUserExists } from "@/lib/auth/sync-user"
import { headers } from "next/headers"
import { OnboardingWrapper } from "@/components/onboarding-wrapper"

import db from "@/lib/db"

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  console.log('[DashboardLayout] START - Layout rendering');
  console.time('[DashboardLayout] Total Time');

  // Ensure the user exists in our local database whenever they access the dashboard
  console.time('[DashboardLayout] currentUser()');
  const user = await currentUser();
  console.timeEnd('[DashboardLayout] currentUser()');

  if (user) {
    console.log(`[DashboardLayout] User: ${user.id} (${user.emailAddresses[0]?.emailAddress})`);
  } else {
    console.log('[DashboardLayout] No user found via currentUser()');
  }

  if (!user) {
    // This shouldn't happen as middleware protects /admin, but safety first
    redirect('/sign-in');
  }

  console.time('[DashboardLayout] ensureUserExists()');
  const localUser = await ensureUserExists(user);
  console.timeEnd('[DashboardLayout] ensureUserExists()');
  console.log(`[DashboardLayout] Local User ensuring complete. ID: ${localUser?.id}`);

  // AUTHORIZATION CHECK: Verify user has access to at least one location
  // Public users (signed up via satellite domains) won't have any location access
  console.time('[DashboardLayout] db.user.findUnique (locations)');
  const userWithLocations = await db.user.findUnique({
    where: { clerkId: user.id },
    include: {
      locations: {
        take: 1,
        select: { id: true }
      }
    }
  });
  console.timeEnd('[DashboardLayout] db.user.findUnique (locations)');
  console.log(`[DashboardLayout] Locations found: ${userWithLocations?.locations?.length || 0}`);

  if (!userWithLocations?.locations?.length) {
    // User has no admin access - redirect to appropriate page
    // Check if we're on a tenant domain and redirect to tenant home
    const headersList = await headers();
    const hostname = headersList.get('host') || '';
    const isSystemDomain = ['localhost:3000', 'estio.co', 'localhost'].includes(hostname.replace(':3000', ''));

    if (isSystemDomain) {
      // On main domain, redirect to home
      redirect('/');
    } else {
      // On tenant domain, redirect to favorites (Public User Dashboard)
      // This "Soft Redirect" prevents them from seeing the Admin UI while keeping them in their allowed area
      redirect('/favorites');
    }
  }

  // Check if user needs onboarding (missing firstName or lastName)
  console.time('[DashboardLayout] db.user.findUnique (profile)');
  const userProfile = await db.user.findUnique({
    where: { clerkId: user.id },
    select: { firstName: true, lastName: true, phone: true }
  });
  console.timeEnd('[DashboardLayout] db.user.findUnique (profile)');

  const needsOnboarding = !userProfile?.firstName || !userProfile?.lastName;

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
          firstName: userProfile?.firstName || '',
          lastName: userProfile?.lastName || '',
          phone: userProfile?.phone || ''
        }}
      />
    </div>
  )
}
