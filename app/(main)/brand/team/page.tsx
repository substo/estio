import { AppShell } from "@/components/app-shell/app-shell";
import { getStudioShellData } from "../../studio/_components/studio-shell-data";
import { redirect } from "next/navigation";
import db from "@/lib/db";
import { listLocationTeam } from "@/lib/locations/location-service";
import { getSubstoLocationActor } from "@/lib/locations/substo-locations";
import { Button } from "@/components/ui/button";
import { revokeLocationInvitationAction } from "../actions";
import { InviteMemberForm, MemberRoleForm, RemoveMemberForm } from "../_components/location-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team" };

export default async function BrandTeamPage() {
  // The active Location is the only tenant input, as for the header and its widgets.
  const actor = await getSubstoLocationActor();
  if (!actor) redirect("/studio/select?choose=1");
  const shell = await getStudioShellData({ locationId: actor.locationId });
  if (!shell) redirect("/studio/select?error=access");
  const isAdmin = actor.role === "ADMIN";
  const { members, invitations } = await listLocationTeam(db, actor.locationId);

  return (
    <AppShell product="studio" {...shell} key={actor.locationId}><main className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{actor.locationName}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
        <p className="text-muted-foreground">Everyone here can use this brand&apos;s CRM and Studio according to their role. Admins manage the team and AI settings.</p>
      </header>

      {isAdmin ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Invite someone</h2>
          <p className="mb-4 mt-1 text-sm text-muted-foreground">They get an email from Substo. If they already have a Substo account, they are added right away.</p>
          <InviteMemberForm locationId={actor.locationId} />
        </section>
      ) : null}

      <section className="rounded-xl border bg-card">
        <h2 className="border-b p-5 text-lg font-medium">Members ({members.length})</h2>
        <ul className="divide-y">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name}{member.id === actor.userId ? " (you)" : ""}</p>
                <p className="truncate text-sm text-muted-foreground">{member.email}</p>
              </div>
              <div className="flex items-start gap-2">
                {isAdmin
                  ? <MemberRoleForm locationId={actor.locationId} userId={member.id} role={member.role} disabled={false} />
                  : <span className="text-sm text-muted-foreground">{member.role === "ADMIN" ? "Admin" : "Member"}</span>}
                {isAdmin && member.id !== actor.userId ? <RemoveMemberForm locationId={actor.locationId} userId={member.id} label="Remove" /> : null}
                {member.id === actor.userId ? <RemoveMemberForm locationId={actor.locationId} userId={member.id} label="Leave brand" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {invitations.length > 0 ? (
        <section className="rounded-xl border bg-card">
          <h2 className="border-b p-5 text-lg font-medium">Pending invitations</h2>
          <ul className="divide-y">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-medium">{invitation.email}</p>
                  <p className="text-sm text-muted-foreground">{invitation.role === "ADMIN" ? "Admin" : "Member"} · invited {invitation.createdAt.toLocaleDateString("en-GB")}</p>
                </div>
                {isAdmin ? (
                  <form action={revokeLocationInvitationAction}>
                    <input type="hidden" name="locationId" value={actor.locationId} />
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <Button type="submit" variant="ghost" size="sm">Revoke</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main></AppShell>
  );
}
