import Link from "next/link";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ImpersonationForm } from "./_components/impersonation-form";

export default async function ImpersonationPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  const locationId = String((await searchParams).locationId || "").trim();
  if (!locationId) notFound();
  const location = await db.location.findUnique({ where: { id: locationId }, select: { id: true, name: true } });
  if (!location) notFound();
  const members = await db.user.findMany({
    where: {
      clerkId: { not: null },
      locations: { some: { id: location.id } },
      locationRoles: { some: { locationId: location.id } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  const audits = await db.impersonationAudit.findMany({
    where: { locationId: location.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, createdAt: true, status: true, reason: true, activatedAt: true, endedAt: true,
      actor: { select: { email: true } }, target: { select: { email: true } },
    },
  });

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Support access</h1><p className="text-sm text-muted-foreground">{location.name || "Unnamed location"}</p></div>
        <Button asChild variant="outline"><Link href="/platform">Back to locations</Link></Button>
      </div>
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
        Support sessions are limited to 15 minutes and read-only. Team, offboarding, billing, integrations, security settings, and reset surfaces are unavailable.
      </div>
      {members.length ? <ImpersonationForm locationId={location.id} members={members.map((member) => ({ id: member.id, email: member.email, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email }))} /> : <p className="rounded-lg border p-5 text-muted-foreground">No active members with a linked Clerk identity.</p>}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent support access</h2>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm">
          <thead className="bg-muted/50 text-left"><tr><th className="p-3">Created</th><th className="p-3">Actor</th><th className="p-3">Target</th><th className="p-3">Status</th><th className="p-3">Reason</th></tr></thead>
          <tbody>{audits.map((audit) => <tr key={audit.id} className="border-t"><td className="p-3">{audit.createdAt.toLocaleString()}</td><td className="p-3">{audit.actor.email}</td><td className="p-3">{audit.target.email}</td><td className="p-3">{audit.status}</td><td className="max-w-xs p-3">{audit.reason}</td></tr>)}{!audits.length ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No support sessions recorded.</td></tr> : null}</tbody>
        </table></div>
      </section>
    </main>
  );
}
