import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { StudioShell } from "../_components/studio-shell";
import { getStudioShellData } from "../_components/studio-shell-data";
import { ensureEstioStudioWorkspace } from "@/lib/studio/supabase-service";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { ensureBrandWorkspace } from "@/lib/brands/brand-service";
import { prepareCurrentSubstoUser, substoBrandDeps } from "@/lib/brands/substo-brands";
import { openEstioStudioLocation, openSubstoBrandStudioAction } from "../actions";

export const dynamic = "force-dynamic";

async function StudioWorkspaceSelector({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; choose?: string }>;
}) {
  const host = (await headers()).get("host");
  const brand = resolveHostBrand(host, getHostBrandConfig());
  const params = await searchParams;
  if (brand === "substo") {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fstudio");
    let prepared: Awaited<ReturnType<typeof prepareCurrentSubstoUser>>;
    try {
      prepared = await prepareCurrentSubstoUser();
    } catch (error) {
      console.error("[Substo] Brand setup failed", error);
      return <SubstoSetupError />;
    }
    if (!prepared) return <SubstoSetupError reason="verified-email" />;
    const { brands } = prepared;

    const active = await resolveActiveLocation();
    // The validated active tenant, including a sole membership, wins on ordinary entry.
    if (active.location && !params.choose && !params.error) {
      const workspaceId = await ensureBrandWorkspace(substoBrandDeps(), active.location, userId);
      redirect(`/studio`);
    }

    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Choose a brand</h1>
          <p className="text-muted-foreground">Each brand has its own team, CRM and Studio content.</p>
        </header>

        {params.error === "access" ? <p className="text-sm text-destructive">You no longer have access to that brand.</p> : null}
        {brands.length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2" aria-label="Your brands">
            {brands.map((item) => (
              <form key={item.id} action={openSubstoBrandStudioAction}>
                <input type="hidden" name="brandId" value={item.id} />
                <button type="submit" className="w-full rounded-xl border bg-card p-5 text-left transition hover:border-primary/50 hover:bg-accent/40">
                  <span className="block font-medium">{item.name}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{item.role === "ADMIN" ? "Admin" : "Member"}</span>
                </button>
              </form>
            ))}
          </section>
        ) : (
          <p className="rounded-xl border bg-muted/20 p-5 text-sm text-muted-foreground">
            You do not have access to a brand. Ask its administrator to invite you.
          </p>
        )}

      </main>
    );
  }

  if (brand !== "estio") notFound();
  const resolution = await resolveActiveLocation();
  if (resolution.status === "unauthenticated") redirect("/sign-in?redirect_url=%2Fstudio");
  if (resolution.location && !params.choose && !params.error) {
    const workspace = await ensureEstioStudioWorkspace(resolution.location);
    redirect(`/studio`);
  }
  const { actor } = await auth();
  const availableLocations = actor
    ? resolution.availableLocations.filter((location) => location.id === resolution.location?.id)
    : resolution.availableLocations;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Estio Studio</p>
        <h1 className="text-3xl font-semibold tracking-tight">Choose a location</h1>
        <p className="text-muted-foreground">Studio access follows your Estio team access for each location.</p>
      </header>

      {params.error === "access" ? <p className="text-sm text-destructive">You no longer have access to that location.</p> : null}
      {availableLocations.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Locations you can access">
          {availableLocations.map((location) => (
            <form key={location.id} action={openEstioStudioLocation}>
              <input type="hidden" name="locationId" value={location.id} />
              <button type="submit" className="w-full rounded-xl border bg-card p-5 text-left transition hover:border-primary/50 hover:bg-accent/40">
                <span className="block font-medium">{location.name || "Untitled location"}</span>
                <span className="mt-1 block text-sm text-muted-foreground">Open this location’s Studio</span>
              </button>
            </form>
          ))}
        </section>
      ) : (
        <p className="rounded-xl border bg-muted/20 p-5 text-sm text-muted-foreground">
          You do not currently have access to an active Estio location.
        </p>
      )}


    </main>
  );
}

function SubstoSetupError({ reason }: { reason?: "verified-email" }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-3 p-6 md:p-10">
      <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t open your brand</h1>
      <p className="text-muted-foreground">
        {reason === "verified-email"
          ? "Verify your email address in your account settings, then reload this page."
          : "Something went wrong while setting up your brand. Reload the page to try again."}
      </p>
    </main>
  );
}

export default async function StudioPage(props: { searchParams: Promise<{ error?: string; choose?: string }> }) {
  const content = await StudioWorkspaceSelector(props);
  const shell = await getStudioShellData();
  return shell ? <StudioShell {...shell}>{content}</StudioShell> : content;
}
