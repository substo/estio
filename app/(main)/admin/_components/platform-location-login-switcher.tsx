"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const targetUser = selectedLocation?.members.find((member) => member.id === targetUserId);

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
    <div className="flex min-w-0 items-center gap-1 sm:gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label="Choose location"
            disabled={busy}
            className="h-10 min-w-0 max-w-[10rem] gap-1.5 px-2 text-sm font-medium sm:max-w-[16rem]"
          >
            <span className="truncate">{selectedLocation?.name || "Estio"}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[14rem] max-w-[calc(100vw-1.5rem)]">
          <DropdownMenuRadioGroup value={selectedLocation?.id || ""} onValueChange={selectLocation}>
            {locations.map((location) => (
              <DropdownMenuRadioItem key={location.id} value={location.id} disabled={busy} className="min-h-10">
                <span className="truncate">{location.name || "Unnamed location"}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedLocation && !selectedLocation.isPlatformMaster ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label="Choose user"
                disabled={busy || selectedLocation.members.length === 0}
                className="h-9 min-w-0 max-w-[8rem] gap-1 px-2 text-sm sm:max-w-[15rem]"
              >
                <span className="truncate">{targetUser?.name || "No users"}</span>
                <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[15rem] max-w-[calc(100vw-1.5rem)]">
              <DropdownMenuRadioGroup value={targetUserId} onValueChange={setTargetUserId}>
                {selectedLocation.members.map((member) => (
                  <DropdownMenuRadioItem key={member.id} value={member.id} disabled={busy} className="min-h-10">
                    <span className="min-w-0">
                      <span className="block truncate">{member.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="sm" onClick={logInAsUser} disabled={busy || !targetUserId} className="shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Logging in" /> : <span className="hidden sm:inline">Log in as user</span>}
            {!busy ? <span className="sm:hidden">Log in</span> : null}
          </Button>
        </>
      ) : null}
      {error ? <p role="alert" aria-live="assertive" className="max-w-[12rem] text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
