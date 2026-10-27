import { AppShell } from "@/components/app-shell/app-shell";
import { getStudioShellData } from "../../studio/_components/studio-shell-data";
import { redirect } from "next/navigation";
import { getSubstoLocationActor } from "@/lib/locations/substo-locations";
import { RenameLocationForm } from "../_components/location-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "General settings" };

export default async function BrandSettingsPage() {
  // The active Location is the only tenant input, as for the header and its widgets.
  const actor = await getSubstoLocationActor();
  if (!actor) redirect("/studio/select?choose=1");
  const shell = await getStudioShellData({ locationId: actor.locationId });
  if (!shell) redirect("/studio/select?error=access");
  const isAdmin = actor.role === "ADMIN";

  return (
    <AppShell product="studio" {...shell} key={actor.locationId}><main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">General settings</h1>
        <p className="text-muted-foreground">Manage the name used across CRM and Studio for {actor.locationName}.</p>
      </header>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-lg font-medium">Name</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">{isAdmin ? "Shown to your team in CRM and Studio." : "Only brand admins can rename the brand."}</p>
        <RenameLocationForm locationId={actor.locationId} name={actor.locationName} disabled={!isAdmin} />
      </section>
    </main></AppShell>
  );
}
