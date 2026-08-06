"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type LocationOption = { id: string; name: string | null };

export function ActiveLocationSwitcher({ activeLocationId, locations }: { activeLocationId: string; locations: LocationOption[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const active = locations.find((location) => location.id === activeLocationId);

  async function switchLocation(locationId: string) {
    if (locationId === activeLocationId || pendingId) return;
    setPendingId(locationId);
    setError("");
    try {
      const response = await fetch("/api/active-location", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, returnTo: window.location.pathname + window.location.search }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Location could not be changed.");
      window.location.reload();
    } catch (reason) {
      setPendingId(null);
      setError(reason instanceof Error ? reason.message : "Location could not be changed.");
    }
  }

  return (
    <div className="min-w-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label="Switch location"
            disabled={Boolean(pendingId)}
            className="h-10 min-w-0 max-w-[11rem] gap-1.5 px-2 text-sm font-medium sm:max-w-[16rem] focus-visible:ring-2"
          >
            {pendingId ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : null}
            <span className="truncate">{active?.name || "Unnamed location"}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[14rem] max-w-[calc(100vw-1.5rem)]">
          <DropdownMenuRadioGroup value={activeLocationId} onValueChange={switchLocation}>
            {locations.map((location) => (
              <DropdownMenuRadioItem key={location.id} value={location.id} disabled={Boolean(pendingId)} className="min-h-10">
                <span className="truncate">{location.name || "Unnamed location"}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p role="alert" aria-live="assertive" className="sr-only">{error}</p>
    </div>
  );
}
