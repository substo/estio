import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfileYoutubeSummary } from "@/lib/google/profile-youtube";
import { isStudioProviderUnavailable } from "@/lib/studio/rest";
import { StudioUnavailable } from "@/app/(main)/studio/_components/studio-unavailable";
export const dynamic = "force-dynamic";
export default async function ProfileConnectionsPage({ searchParams }: { searchParams: Promise<{ youtube?: string }> }) {
  let result: Awaited<ReturnType<typeof getProfileYoutubeSummary>>;
  // Profile connections are stored in Studio's database.
  try { result = await getProfileYoutubeSummary(); }
  catch (error) { if (isStudioProviderUnavailable(error)) return <StudioUnavailable />; throw error; }
  if (!result) notFound();
  const status = (await searchParams).youtube;
  return <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
    <Link href="/studio" className="text-sm text-primary hover:underline">Back to workspaces</Link>
    <h1 className="text-3xl font-semibold">My profile connections</h1>
    <p className="text-muted-foreground">Connections belong to your {result.profile.brand === "estio" ? "Estio" : "Substo"} profile. Each app keeps its own sign-in identity and grants.</p>
    <section className="space-y-4 rounded-xl border bg-card p-6">
      <h2 className="text-xl font-medium">Google · YouTube read access</h2>
      <p className="text-sm">Your subscriptions are private to your profile. Studio can use this connection when you choose to discover research. Saving a public video to a workspace explicitly shares that research link and its discovery source with members.</p>
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
  </main>;
}
