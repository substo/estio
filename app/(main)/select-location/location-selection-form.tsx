"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type LocationOption = { id: string; name: string | null };

export function LocationSelectionForm({ locations, hasAccessError }: { locations: LocationOption[]; hasAccessError: boolean }) {
  const [selected, setSelected] = useState("");
  return (
    <form action="/api/active-location" method="post" className="space-y-5">
      <input type="hidden" name="returnTo" value="/admin" />
      <fieldset className="space-y-2">
        <legend className="sr-only">Available locations</legend>
        {locations.map((location) => (
          <label key={location.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring">
            <input type="radio" name="locationId" value={location.id} required checked={selected === location.id} onChange={() => setSelected(location.id)} />
            <span className="font-medium">{location.name || "Unnamed location"}</span>
          </label>
        ))}
      </fieldset>
      {hasAccessError ? <p role="alert" className="text-sm text-destructive">That location is no longer available. Choose another location.</p> : null}
      <Button type="submit" disabled={!selected} className="min-h-11 w-full">Continue</Button>
    </form>
  );
}
