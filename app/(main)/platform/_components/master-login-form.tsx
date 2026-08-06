"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Member = { id: string; name: string; email: string };
type LocationOption = { id: string; name: string; members: Member[] };

export function MasterLoginForm({ locations, initialLocationId }: { locations: LocationOption[]; initialLocationId?: string }) {
  const initialLocation = locations.find((location) => location.id === initialLocationId)
    || locations.find((location) => location.members.length > 0)
    || locations[0];
  const [locationId, setLocationId] = useState(initialLocation?.id || "");
  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === locationId) || locations[0],
    [locationId, locations],
  );
  const [targetUserId, setTargetUserId] = useState(initialLocation?.members[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeLocation(nextLocationId: string) {
    const nextLocation = locations.find((location) => location.id === nextLocationId);
    setLocationId(nextLocationId);
    setTargetUserId(nextLocation?.members[0]?.id || "");
    setError(null);
  }

  async function logInAsUser(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLocation || !targetUserId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/impersonation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, locationId: selectedLocation.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.launchUrl) throw new Error(result.error || "Unable to log in as this user.");
      window.location.assign(result.launchUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to log in as this user.");
      setBusy(false);
    }
  }

  if (!locations.length) {
    return <p className="rounded-lg border p-5 text-muted-foreground">No locations are available.</p>;
  }

  return (
    <form onSubmit={logInAsUser} className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <Label htmlFor="master-location">Location</Label>
        <select id="master-location" value={selectedLocation?.id || ""} onChange={(event) => changeLocation(event.target.value)} className="min-h-11 w-full rounded-md border bg-background px-3">
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="master-user">User</Label>
        <select id="master-user" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} disabled={!selectedLocation?.members.length} className="min-h-11 w-full rounded-md border bg-background px-3 disabled:opacity-60">
          {selectedLocation?.members.length
            ? selectedLocation.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)
            : <option value="">No users in this location</option>}
        </select>
      </div>
      <Button type="submit" disabled={busy || !targetUserId}>{busy ? "Logging in…" : "Log in as user"}</Button>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
