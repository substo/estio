"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  changeLocationMemberRoleAction,
  inviteLocationMemberAction,
  removeLocationMemberAction,
  renameLocationAction,
  type LocationFormState,
} from "../actions";

function Feedback({ state }: { state: LocationFormState }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  if (state.message) return <p role="status" className="text-sm text-muted-foreground">{state.message}</p>;
  return null;
}

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";

export function InviteMemberForm({ locationId }: { locationId: string }) {
  const [state, action, pending] = useActionState(inviteLocationMemberAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="locationId" value={locationId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="invite-email">Email address</label>
        <input id="invite-email" name="email" type="email" required maxLength={254} placeholder="name@example.com" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" />
        <label className="sr-only" htmlFor="invite-role">Role</label>
        <select id="invite-role" name="role" defaultValue="MEMBER" className={selectClass}>
          <option value="MEMBER">Member</option>
          <option value="ADMIN">Admin</option>
        </select>
        <Button type="submit" size="sm" className="h-9" disabled={pending}>{pending ? "Inviting…" : "Invite"}</Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function MemberRoleForm({ locationId, userId, role, disabled }: { locationId: string; userId: string; role: "ADMIN" | "MEMBER"; disabled: boolean }) {
  const [state, action, pending] = useActionState(changeLocationMemberRoleAction, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        disabled={disabled || pending}
        aria-label="Role"
        className={selectClass}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="MEMBER">Member</option>
        <option value="ADMIN">Admin</option>
      </select>
      <Feedback state={state} />
    </form>
  );
}

export function RemoveMemberForm({ locationId, userId, label }: { locationId: string; userId: string; label: string }) {
  const [state, action, pending] = useActionState(removeLocationMemberAction, {});
  return (
    <form
      action={action}
      className="flex flex-col items-end gap-1"
      onSubmit={(event) => { if (!window.confirm(`${label}?`)) event.preventDefault(); }}
    >
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>{label}</Button>
      <Feedback state={state} />
    </form>
  );
}

export function RenameLocationForm({ locationId, name, disabled }: { locationId: string; name: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(renameLocationAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="locationId" value={locationId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="brand-name">Brand name</label>
        <input id="brand-name" name="name" defaultValue={name} required maxLength={100} disabled={disabled} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm" />
        <Button type="submit" size="sm" className="h-9" disabled={disabled || pending}>Save</Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}
