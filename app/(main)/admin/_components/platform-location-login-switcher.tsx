"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlatformLocationLoginOption } from "@/lib/auth/platform-location-options";

export function PlatformLocationLoginSwitcher({
  activeLocationId,
  locations,
}: {
  activeLocationId: string;
  locations: PlatformLocationLoginOption[];
}) {
  const [selectedLocationId, setSelectedLocationId] = useState(activeLocationId);
  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === selectedLocationId) || locations[0],
    [locations, selectedLocationId],
  );
  const [targetUserId, setTargetUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function selectLocation(locationId: string) {
    const location = locations.find((candidate) => candidate.id === locationId);
    setSelectedLocationId(locationId);
    setTargetUserId(location?.isPlatformMaster ? "" : location?.members[0]?.id || "");
    setError("");
  }

  async function logInAsUser() {
    if (!selectedLocation || selectedLocation.isPlatformMaster || !targetUserId) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/platform/impersonation/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, locationId: selectedLocation.id }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.launchUrl) throw new Error(result?.error || "Unable to log in as this user.");
      window.location.assign(result.launchUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to log in as this user.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor="platform-location-login" className="sr-only">Location</label>
      <select
        id="platform-location-login"
        aria-label="Location"
        value={selectedLocation?.id || ""}
        onChange={(event) => selectLocation(event.target.value)}
        disabled={busy}
        className="h-10 min-w-0 max-w-[11rem] rounded-md border bg-background px-2 text-sm font-medium sm:max-w-[15rem]"
      >
        {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
      </select>

      {selectedLocation && !selectedLocation.isPlatformMaster ? (
        <>
          <label htmlFor="platform-user-login" className="sr-only">User</label>
          <select
            id="platform-user-login"
            aria-label="User"
            value={targetUserId}
            onChange={(event) => setTargetUserId(event.target.value)}
            disabled={busy || selectedLocation.members.length === 0}
            className="h-10 min-w-0 max-w-[10rem] rounded-md border bg-background px-2 text-sm sm:max-w-[15rem]"
          >
            {selectedLocation.members.length > 0
              ? selectedLocation.members.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)
              : <option value="">No users</option>}
          </select>
          <Button type="button" size="sm" onClick={logInAsUser} disabled={busy || !targetUserId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Logging in" /> : "Log in as user"}
          </Button>
        </>
      ) : null}
      {error ? <p role="alert" aria-live="assertive" className="max-w-[12rem] text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
