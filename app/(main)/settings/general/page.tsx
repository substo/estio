import Link from "next/link";
import { getSubstoLocationActor } from "@/lib/locations/substo-locations";
import { requireSettingsContext } from "../_components/context";
import { RenameLocationForm } from "../_components/substo-location-forms";

export const metadata = { title: "General settings" };

export default async function GeneralSettingsPage() {
  const { app, access } = await requireSettingsContext();
  if (!access) return null;
  const actor = app === "substo" ? await getSubstoLocationActor() : null;
  const profileHref = app === "substo" ? "/studio/onboarding?update=1" : "/admin/onboarding?update=1";

  return <main className="max-w-3xl space-y-6">
    <h1 className="text-2xl font-semibold tracking-tight">General settings</h1>
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-lg font-medium">Business profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">Business details, offer, market and brand used across CRM, Studio, website and AI.</p>
      </div>
      <Link href={profileHref} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">Open business profile</Link>
    </section>
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-lg font-medium">Name</h2>
      {actor ? <>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">{actor.role === "ADMIN" ? "Shown to your team in CRM and Studio." : "Only brand admins can rename the brand."}</p>
        <RenameLocationForm locationId={actor.locationId} name={actor.locationName} disabled={actor.role !== "ADMIN"} />
      </> : <p className="mt-1 text-sm text-muted-foreground">{access.locationName}</p>}
    </section>
  </main>;
}
