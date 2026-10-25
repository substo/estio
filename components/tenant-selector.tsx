"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type TenantOption = { id: string; name: string | null };

/** Presentation shared by CRM and Studio. The server always authorizes selection. */
export function TenantSelector({ activeLocationId, locations, noun, onSelect }: {
  activeLocationId: string | null;
  locations: TenantOption[];
  noun: "location" | "brand";
  onSelect: (locationId: string) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const name = locations.find((item) => item.id === activeLocationId)?.name?.trim() || `Unnamed ${noun}`;
  if (!locations.length) return <span className="truncate text-sm text-muted-foreground">No {noun} access</span>;
  if (locations.length === 1 && activeLocationId === locations[0].id) return <span title={name} className="min-w-0 truncate text-sm font-medium">{name}</span>;
  async function select(id: string) {
    if (pending || id === activeLocationId) return;
    setPending(true); setError("");
    try { await onSelect(id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : `Could not change ${noun}.`); setPending(false); }
  }
  return <div className="min-w-0">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" aria-label={`Switch ${noun}`} disabled={pending} className="h-10 min-w-0 max-w-[10rem] gap-1.5 px-2 sm:max-w-[16rem]">
          {pending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : null}
          <span className="truncate" title={name}>{activeLocationId ? name : `Choose a ${noun}`}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem] max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuRadioGroup value={activeLocationId ?? ""} onValueChange={select}>
          {locations.map((location) => <DropdownMenuRadioItem key={location.id} value={location.id} disabled={pending} className="min-h-10">
            <span className="truncate">{location.name?.trim() || `Unnamed ${noun}`}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {error ? <p role="alert" aria-live="assertive" className="max-w-64 text-xs text-destructive">{error}</p> : null}
  </div>;
}
