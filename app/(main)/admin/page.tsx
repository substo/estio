import Link from "next/link";
import { ArrowRight, BarChart3, ShieldCheck } from "lucide-react";
import { GlobalAiUsageWidget } from "./_components/global-ai-usage-widget";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@clerk/nextjs/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";

export default async function Dashboard() {
  const [{ userId }, location, platformAdmin] = await Promise.all([
    auth(),
    getLocationContext(),
    getPlatformAdminContext(),
  ]);
  const isLocationAdmin = Boolean(
    userId &&
    location?.id &&
    await verifyUserIsLocationAdmin(userId, location.id)
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome to the Estio Dashboard.</p>
      </div>

      {(isLocationAdmin || platformAdmin) && (
        <div className="grid gap-4 md:grid-cols-2">
          {isLocationAdmin ? <Link href="/admin/analytics" className="group block">
            <Card className="h-full transition-colors hover:border-gray-400">
              <CardContent className="flex h-full items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
                    <BarChart3 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold">Analytics</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Review visitors, sessions, listing views, traffic sources, leads, and admin usage.
                  </p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </CardContent>
            </Card>
          </Link> : null}
          {platformAdmin ? <Link href="/admin/platform" className="group block">
            <Card className="h-full transition-colors hover:border-gray-400">
              <CardContent className="flex h-full items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted/30">
                    <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold">Platform overview</h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Review a simple breakdown of locations, memberships, contacts, properties, and recent activity.
                  </p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </CardContent>
            </Card>
          </Link> : null}
        </div>
      )}

      <GlobalAiUsageWidget canViewLocationUsage={isLocationAdmin} />
    </div>
  );
}
