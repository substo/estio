import { notFound } from "next/navigation";
import { getPlatformProfile } from "@/lib/platform/profile";
import { getStudioAccess } from "@/lib/studio/access";
import { getStudioDevices } from "@/lib/studio/devices";
import { studioRouteParams } from "@/lib/studio/route-context";
import { CompanionSettings } from "./companion-settings";

export const dynamic = "force-dynamic";

export default async function StudioConnectedComputerPage({ params, searchParams }: { params: Promise<{}>; searchParams: Promise<{ code?: string | string[] }> }) {
  const { locationId } = await studioRouteParams(params);
  const [devices, access, profile, query] = await Promise.all([getStudioDevices(locationId), getStudioAccess(locationId), getPlatformProfile(), searchParams]);
  if (!devices || !access) notFound();
  const code = typeof query.code === "string" && /^[A-Za-z0-9-]{4,16}$/.test(query.code) ? query.code : null;
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Connected computer</h1>
        <p className="text-muted-foreground">Connect a Mac to this Business, choose what it may do, and see its status.</p>
      </header>
      <CompanionSettings {...devices} origin={profile?.origin ?? "https://substo.com"} businessName={access.locationName} code={code} />
    </main>
  );
}
