import { notFound } from "next/navigation";
import { getPlatformProfile } from "@/lib/platform/profile";
import { getStudioDevices } from "@/lib/studio/devices";
import { requireSettingsContext } from "../_components/context";
import { CompanionSettings } from "./companion-settings";

export const dynamic = "force-dynamic";

export default async function StudioConnectedComputerPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { locationId, access, tenantHost } = await requireSettingsContext();
  if (tenantHost) notFound();
  if (!locationId || !access) return null;
  const [devices, profile, query] = await Promise.all([getStudioDevices(locationId), getPlatformProfile(), searchParams]);
  if (!devices) notFound();
  const code = typeof query.code === "string" && /^[A-Za-z0-9-]{4,16}$/.test(query.code) ? query.code : null;
  return (
    <main className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Connected computer</h1>
        <p className="text-muted-foreground">Your own Mac does the transcribing, summarising and searching, using your Codex or Claude subscription. See what works, fix what does not, and connect another computer.</p>
      </header>
      <CompanionSettings {...devices} origin={profile?.origin ?? "https://substo.com"} businessName={access.locationName} code={code} />
    </main>
  );
}
