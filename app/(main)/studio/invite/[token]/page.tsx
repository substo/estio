import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolveHostBrand, getHostBrandConfig } from "@/lib/auth/host-brand";
import { acceptSubstoStudioInviteAction } from "../../actions";
import { getSubstoStudioInvitation } from "@/lib/studio/supabase-service";

import { studioInvitationStatus } from "@/lib/studio/invitation-policy";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };

export default async function AcceptStudioInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) notFound();
  const host = (await headers()).get("host");
  if (resolveHostBrand(host, getHostBrandConfig()) !== "substo") notFound();

  const invitation = await getSubstoStudioInvitation(token);
  if (!invitation) notFound();
  const { userId } = await auth();
  if (!userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/studio/invite/${token}`)}`);
  const { error } = await searchParams;
  const status = studioInvitationStatus(invitation, userId);
  const canAccept = status === "pending" || status === "accepted";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-56px)] w-full max-w-xl flex-col justify-center gap-6 p-6">
      <header className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Substo Studio invitation</p>
        <h1 className="text-3xl font-semibold tracking-tight">Join a workspace</h1>
        <p className="text-muted-foreground">This invitation is for <strong className="font-medium text-foreground">{invitation.email}</strong>. Accept it using a Clerk account with that verified email address.</p>
      </header>
      {error === "email-mismatch" ? <p role="alert" className="text-sm text-destructive">Your signed-in account does not have this verified email address.</p> : null}
      {error === "verified-email" ? <p role="alert" className="text-sm text-destructive">Verify the invited email address in your account, then try again.</p> : null}
      {error === "invalid" || !canAccept ? <p role="alert" className="text-sm text-destructive">This invitation is no longer valid.</p> : null}
      {canAccept ? <form action={acceptSubstoStudioInviteAction.bind(null, token)}>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Accept invitation</button>
      </form> : null}
    </main>
  );
}
