import { getBrandProfile } from "@/lib/brand-profile/service";
import { studioRouteParams } from "@/lib/studio/route-context";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getStudioAccess } from "@/lib/studio/access";
import { listStudioLibrary } from "@/lib/studio/library";
import { onboardingRedirectFor } from "@/lib/onboarding/auto-open";
import { ComputerReadiness } from "../_components/computer-readiness";
import { LibraryCards } from "../_components/library-cards";
import { LibraryAddDialog } from "../_components/library-add-dialog";

export const dynamic = "force-dynamic";

const areas = [
  { href: "/studio/library", label: "Research library", hint: "Sources, channels, notes" },
  { href: "/studio/content", label: "Content pipeline", hint: "Ideas to review" },
  { href: "/studio/knowledge", label: "Knowledge", hint: "Cited findings" },
  { href: "/studio/schedules", label: "Schedules", hint: "Recurring drafts" },
  { href: "/studio/voices", label: "Voices", hint: "Narration voices and clones" },
];

export default async function StudioWorkspacePage({ params }: { params: Promise<{}> }) {
  const { locationId } = await studioRouteParams(params);
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fstudio");
  const access = await getStudioAccess(locationId);
  if (!access) notFound();
  // Until the business profile is finished, an admin lands on onboarding ("Later" defers it for the session).
  const onboardingPath = access.role === "ADMIN" ? await onboardingRedirectFor(locationId, "studio") : null;
  if (onboardingPath) redirect(onboardingPath);

  const [profile, library] = await Promise.all([getBrandProfile(locationId), listStudioLibrary(locationId, 0, { kind: "reference" }).catch(() => null)]);
  const recent = library?.records.slice(0, 6) ?? [];
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-5 p-4 md:px-8 md:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><p className="text-xs text-muted-foreground">{access.app === "substo" ? "Studio" : "Estio Studio"}</p><h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{access.locationName}</h1></div>
        {recent.length ? <LibraryAddDialog key={locationId} locationId={locationId} /> : null}
      </header>
      {!profile ? <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm"><span><span className="font-medium">Set up your brand.</span> <span className="text-muted-foreground">Ideas and research use it as context.</span></span><Link className="font-medium text-primary hover:underline" href="/studio/onboarding">Fill in your business profile</Link></section> : null}
      <nav aria-label="Studio areas" className="flex flex-wrap gap-2">{areas.map(area => <Link key={area.href} href={area.href} className="inline-flex min-h-10 items-center rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" title={area.hint}>{area.label}</Link>)}</nav>
      <ComputerReadiness locationId={locationId} />
      {recent.length ? <section aria-label="Recent sources" className="space-y-3"><div className="flex items-baseline justify-between gap-3"><h2 className="text-sm font-semibold">Recent sources</h2><Link href="/studio/library" className="text-sm font-medium text-primary hover:underline">Open research library</Link></div><LibraryCards records={recent} /></section>
        : <section className="space-y-2 rounded-xl border border-dashed px-5 py-10 text-center"><h2 className="font-medium">Start your research collection</h2><p className="text-sm text-muted-foreground">Add a video link or post. Then watch it, transcribe it on your Mac and talk through your reaction with the assistant.</p><div className="pt-1"><LibraryAddDialog key={`${locationId}-empty`} locationId={locationId} empty /></div></section>}
    </main>
  );
}
