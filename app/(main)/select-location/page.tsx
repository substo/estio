import { redirect } from "next/navigation";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { LocationSelectionForm } from "./location-selection-form";

export default async function SelectLocationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const resolution = await resolveActiveLocation();
  if (resolution.status === "unauthenticated") redirect("/sign-in");
  if (resolution.status === "authorized") redirect("/admin");

  if (resolution.locationCount === 0) {
    return <main className="mx-auto flex min-h-[60vh] max-w-lg items-center p-6"><p>You do not currently have access to an active location.</p></main>;
  }
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg items-center p-6">
      <section className="w-full space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div><h1 className="text-2xl font-semibold">Choose a location</h1><p className="mt-1 text-sm text-muted-foreground">Select the workspace you want to open.</p></div>
        <LocationSelectionForm locations={resolution.availableLocations} hasAccessError={params.error === "access"} />
      </section>
    </main>
  );
}
