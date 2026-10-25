import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";

export const dynamic = "force-dynamic";

export default async function StudioWorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fstudio");
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) notFound();
  const { workspace } = access;

  if (access.brand === "substo") {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Studio · {access.role}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{workspace.name}</h1>
          </div>
        </div>
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-medium">Research library</h2>
          <p className="mt-2 text-sm text-muted-foreground">Save sources and channels, preserve transcripts and citations, and review your research.</p>
          <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/library`}>Open research library</Link>
        </section>
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-medium">Content pipeline</h2>
          <p className="mt-2 text-sm text-muted-foreground">Develop ideas, write scripts, and move content through production to review.</p>
          <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/content`}>Open content pipeline</Link>
        </section>
        <section className="rounded-xl border bg-card p-6">
          <h2 className="text-lg font-medium">Knowledge</h2>
          <p className="mt-2 text-sm text-muted-foreground">Inspect source findings, exact citations, transcript units, and imported review history.</p>
          <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/knowledge`}>Open knowledge</Link>
          <Link className="ml-4 text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/schedules`}>Schedule drafts</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Estio Studio · {access.role}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{workspace.name}</h1>
        </div>

      </div>
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-medium">Research library</h2>
        <p className="mt-2 text-sm text-muted-foreground">Save sources and channels for this location. Access follows your Estio team role.</p>
        <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/library`}>Open research library</Link>
      </section>
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-medium">Content pipeline</h2>
        <p className="mt-2 text-sm text-muted-foreground">Develop ideas, write scripts, and move content through production to review.</p>
        <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/content`}>Open content pipeline</Link>
      </section>
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-medium">Knowledge</h2>
        <p className="mt-2 text-sm text-muted-foreground">Inspect source findings, exact citations, transcript units, and imported review history.</p>
        <Link className="mt-4 inline-block text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/knowledge`}>Open knowledge</Link>
          <Link className="ml-4 text-sm font-medium text-primary hover:underline" href={`/studio/workspace/${workspace.id}/schedules`}>Schedule drafts</Link>
      </section>
    </main>
  );
}
