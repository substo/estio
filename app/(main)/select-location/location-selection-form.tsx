"use client";

import { crmVocabulary } from "@/lib/branding/crm-vocabulary";
import type { AuthRealm } from "@/lib/auth/auth-realm";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type LocationOption = { id: string; name: string | null };

export function LocationSelectionForm({ locations, hasAccessError, realm = "estio" }: { realm?: AuthRealm; locations: LocationOption[]; hasAccessError: boolean }) {
  const vocabulary = crmVocabulary(realm);
  const [selected, setSelected] = useState("");
  return (
    <form action="/api/active-location" method="post" className="space-y-5">
      <input type="hidden" name="returnTo" value="/admin" />
      <fieldset className="space-y-2">
        <legend className="sr-only">{vocabulary.availableTenants}</legend>
        {locations.map((location) => (
          <label key={location.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring">
            <input type="radio" name="locationId" value={location.id} required checked={selected === location.id} onChange={() => setSelected(location.id)} />
            <span className="font-medium">{location.name || vocabulary.unnamedTenant}</span>
          </label>
        ))}
      </fieldset>
      {hasAccessError ? <p role="alert" className="text-sm text-destructive">That {vocabulary.tenant} is no longer available. Choose another {vocabulary.tenant}.</p> : null}
      <Button type="submit" disabled={!selected} className="min-h-11 w-full">Continue</Button>
    </form>
  );
}
