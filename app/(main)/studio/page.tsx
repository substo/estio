import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { listSubstoStudioWorkspaces } from "@/lib/studio/supabase-service";
import { createSubstoWorkspaceAction, openEstioStudioLocation } from "./actions";

export const dynamic = "force-dynamic";

export default async function StudioWorkspaceSelector({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const host = (await headers()).get("host");
  const brand = resolveHostBrand(host, getHostBrandConfig());
  const params = await searchParams;
  if (brand === "substo") {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fstudio");
    const workspaces = await listSubstoStudioWorkspaces(userId);

    return (
      <main className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
        <header className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Substo</p>
          <h1 className="text-3xl font-semibold tracking-tight">Choose a Studio workspace</h1>
          <p className="text-muted-foreground">Your research, ideas, scripts, and production work stay inside the workspace you choose.</p>
        </header>

        {workspaces.length > 0 ? (
          <section className="grid gap-3 sm:grid-cols-2" aria-label="Your workspaces">
            {workspaces.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/studio/workspace/${workspace.id}`}
                className="rounded-xl border bg-card p-5 transition hover:border-primary/50 hover:bg-accent/40"
              >
                <span className="block font-medium">{workspace.name}</span>
                <span className="mt-1 block text-sm capitalize text-muted-foreground">{workspace.role}</span>
              </Link>
            ))}
          </section>
        ) : (
          <p className="rounded-xl border bg-muted/20 p-5 text-sm text-muted-foreground">
            You are not a member of a workspace yet. Create one or open an invitation link.
          </p>
        )}

        <section className="max-w-xl rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Create a workspace</h2>
          <p className="mt-1 text-sm text-muted-foreground">You will become its owner and can invite teammates later.</p>
          {params.error === "workspace" ? <p className="mt-3 text-sm text-destructive">Enter a name up to 100 characters.</p> : null}
          <form action={createSubstoWorkspaceAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input type="hidden" name="workspaceRequestId" value={randomUUID()} />
            <label className="sr-only" htmlFor="studio-workspace-name">Workspace name</label>
            <input
              id="studio-workspace-name"
              name="name"
              required
              maxLength={100}
              placeholder="e.g. Personal Studio"
              className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
            />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              Create workspace
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (brand !== "estio") notFound();
  const resolution = await resolveActiveLocation();
  if (resolution.status === "unauthenticated") redirect("/sign-in?redirect_url=%2Fstudio");
  const { actor } = await auth();
  const availableLocations = actor
    ? resolution.availableLocations.filter((location) => location.id === resolution.location?.id)
    : resolution.availableLocations;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Estio Studio</p>
        <h1 className="text-3xl font-semibold tracking-tight">Choose a location workspace</h1>
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

      <p><Link className="text-sm text-primary underline-offset-4 hover:underline" href="/admin">Return to Estio Business</Link></p>
    </main>
  );
}
