"use client";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LocationAiKeyProvider } from "@/lib/studio/ai-settings-policy";
import { removeAiKeyAction, saveBudgetAction, saveAiKeyAction } from "./actions";

type State = { error?: string; saved?: string };
function Status({ state }: { state: State }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  return state.saved ? <p role="status" className="text-sm text-muted-foreground">{state.saved}</p> : null;
}

/** The Location provider key shared by CRM and Studio. */
export function AiKeyForm({ locationId, provider, hasKey }: { locationId: string; provider: LocationAiKeyProvider; hasKey: boolean }) {
  const name = provider === "gemini" ? "Gemini" : "OpenAI";
  const [state, action, pending] = useActionState(saveAiKeyAction.bind(null, locationId, provider), {});
  const [removeState, remove, removing] = useActionState(removeAiKeyAction.bind(null, locationId, provider), {});
  const id = useId();
  return <div className="space-y-3">
    <form action={action} className="space-y-2">
      <Label htmlFor={`${id}-key`}>{hasKey ? `Replace ${name} API key` : `${name} API key`}</Label>
      <Input id={`${id}-key`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required placeholder={provider === "openai" ? "sk-…" : undefined} aria-describedby={`${id}-help`} />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">The key is verified with {name} and stored encrypted. Usage is billed to your {name} account.</p>
      <Status state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Checking…" : "Save key"}</Button>
    </form>
    <Status state={removeState} />
    {hasKey ? <form action={remove}>
      <Button type="submit" variant="link" size="sm" className="h-auto px-0 text-destructive" disabled={removing}>{removing ? "Removing…" : "Remove key"}</Button></form> : null}
  </div>;
}

/** The Location monthly cap that every paid step reserves against. */
export function BudgetForm({ locationId, budgetUsd }: { locationId: string; budgetUsd: string }) {
  const [state, action, pending] = useActionState(saveBudgetAction.bind(null, locationId), {});
  const id = useId();
  return <form action={action} className="space-y-2">
    <Label htmlFor={`${id}-cap`}>Monthly spending cap (US dollars)</Label>
    <Input key={budgetUsd} id={`${id}-cap`} name="monthlyBudget" inputMode="decimal" required defaultValue={budgetUsd} className="max-w-40" aria-describedby={`${id}-help`} />
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Paid steps stop for the month when the cap is reached. 0 pauses all paid AI.</p>
    <Status state={state} />
    <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save cap"}</Button>
  </form>;
}
