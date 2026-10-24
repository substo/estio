"use client";

import { useActionState } from "react";
import { createSubstoStudioInviteAction, type CreateStudioInviteState } from "../actions";

const initialState: CreateStudioInviteState = {};

export function StudioInviteForm({ workspaceId, canInviteAdmins }: { workspaceId: string; canInviteAdmins: boolean }) {
  const action = createSubstoStudioInviteAction.bind(null, workspaceId);
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <section className="rounded-xl border bg-card p-6">
      <h2 className="text-lg font-medium">Invite a teammate</h2>
      <p className="mt-1 text-sm text-muted-foreground">The link expires in seven days. Share it with the invited person using their verified email.</p>
      <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="sr-only" htmlFor="studio-invite-email">Email address</label>
        <input id="studio-invite-email" name="email" type="email" required maxLength={320} placeholder="teammate@example.com" className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm" />
        <label className="sr-only" htmlFor="studio-invite-role">Workspace role</label>
        <select id="studio-invite-role" name="role" defaultValue="member" className="h-10 rounded-md border bg-background px-3 text-sm">
          <option value="member">Member</option>
          {canInviteAdmins ? <option value="admin">Admin</option> : null}
        </select>
        <button type="submit" disabled={pending} className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {pending ? "Creating…" : "Create invite link"}
        </button>
      </form>
      {state.error ? <p role="alert" className="mt-3 text-sm text-destructive">{state.error}</p> : null}
      {state.link ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium">Invite link</p>
          <input aria-label="Invite link" readOnly value={state.link} onFocus={(event) => event.currentTarget.select()} className="h-10 w-full rounded-md border bg-muted/30 px-3 text-sm" />
          <p className="text-xs text-muted-foreground">Anyone with this link and access to the invited verified email can accept it. Treat it like a password until it expires.</p>
        </div>
      ) : null}
    </section>
  );
}
