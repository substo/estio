import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfileYoutubeSummary } from "@/lib/google/profile-youtube";
import { isStudioProviderUnavailable } from "@/lib/studio/rest";
import { StudioUnavailable } from "@/app/(main)/studio/_components/studio-unavailable";
import { getStudioShellData } from "@/app/(main)/studio/_components/studio-shell-data";
import { SettingsShell } from "@/app/(main)/settings/_components/settings-nav";
import { visibleSettingsSections } from "@/app/(main)/settings/_components/sections";

const PLANNED_SOCIAL_PLATFORMS = [
  "Instagram", "Facebook", "Threads", "TikTok", "LinkedIn", "X", "Bluesky",
  "Pinterest", "Reddit", "Snapchat", "Twitch", "Discord", "Telegram", "WhatsApp",
];

export const metadata = { title: "My connections" };
export const dynamic = "force-dynamic";
export default async function ProfileConnectionsPage({ searchParams }: { searchParams: Promise<{ youtube?: string }> }) {
  let result: Awaited<ReturnType<typeof getProfileYoutubeSummary>>;
  // Profile connections are stored in Studio's database.
  try { result = await getProfileYoutubeSummary(); }
  catch (error) { if (isStudioProviderUnavailable(error)) return <StudioUnavailable />; throw error; }
  if (!result) notFound();
  const status = (await searchParams).youtube;
  const shell = await getStudioShellData();
  const content = <main className="max-w-3xl space-y-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">My connections</h1>
      <p className="text-muted-foreground">Manage accounts that you authorize {result.profile.brand === "estio" ? "Estio" : "Substo"} to use on your behalf.</p>
      {result.profile.brand === "estio" && shell?.activeLocationId ? <Link href="/settings/integrations" className="text-sm text-primary underline">Business integrations</Link> : null}
    </header>
    <section className="space-y-4 rounded-xl border bg-card p-6">
      <h2 className="text-xl font-medium">Google · YouTube read access</h2>
      <p className="text-sm">Your subscriptions are private to your profile. Studio can use this connection when you choose to discover research. Saving a public video to a business explicitly shares that research link and its discovery source with members.</p>
      {result.connectedAt ? <p className="text-sm">Connected {result.connectedAt}</p> : <p className="text-sm">Not connected.</p>}
      {status === "connected" || status === "removed" ? <p role="status" className="text-sm">{status === "connected" ? "YouTube connected to your profile." : "Saved YouTube access removed from this profile."}</p>
        : status ? <p role="alert" className="text-sm text-destructive">Could not connect. Check server configuration and consent, then try again from your own account.</p> : null}
      {result.configured ? <form action="/account/connections/google-youtube/start" method="post" className="space-y-3">
        <label className="flex gap-2 text-sm"><input type="checkbox" name="consent" value="yes" required />I authorize this app to read my YouTube subscriptions for my personal discovery.</label>
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">{result.connectedAt ? "Reconnect Google" : "Connect Google"}</button>
      </form> : <p className="text-sm text-muted-foreground">Google OAuth and encrypted profile storage must be configured before connecting.</p>}
      {result.connectedAt ? <form action="/account/connections/google-youtube/remove" method="post"><button className="rounded-md border px-4 py-2 text-sm">Remove saved YouTube access</button></form> : null}
      <p className="text-xs text-muted-foreground">Removal deletes this profile’s saved YouTube credential and pending consent requests. It leaves your research notes and other Google integrations unchanged. To revoke the app’s Google grant, use <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-primary underline">Google account permissions</a>.</p>
    </section>
    <section className="space-y-3" aria-labelledby="planned-providers">
      <h2 id="planned-providers" className="text-lg font-medium">Planned social connections</h2>
      <p className="text-sm text-muted-foreground">Connecting these platforms will be available when their permissions and supported actions are ready.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {PLANNED_SOCIAL_PLATFORMS.map(platform => <li key={platform} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="font-medium">{platform}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Planned</span>
        </li>)}
      </ul>
    </section>
  </main>;
  if (!shell) return <div className="p-4 lg:p-6">{content}</div>;
  const role = shell.activeLocationId ? (shell.locationAdmin ? "ADMIN" : "MEMBER") : null;
  return <Suspense>
    <SettingsShell shell={shell} tenantHost={false} sections={visibleSettingsSections(shell.app, role, false)}>
      {content}
    </SettingsShell>
  </Suspense>;
}
