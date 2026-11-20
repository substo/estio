"use client";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeOpenAiKeyAction, saveBudgetAction, saveOpenAiKeyAction } from "./actions";

type State = { error?: string; saved?: string };
function Status({ state }: { state: State }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  return state.saved ? <p role="status" className="text-sm text-muted-foreground">{state.saved}</p> : null;
}

/** The Location OpenAI key (shared by CRM and Studio). Verified with OpenAI, encrypted, never shown again. */
export function OpenAiKeyForm({ locationId, hasKey }: { locationId: string; hasKey: boolean }) {
  const [state, action, pending] = useActionState(saveOpenAiKeyAction.bind(null, locationId), {});
  const [removeState, remove, removing] = useActionState(removeOpenAiKeyAction.bind(null, locationId), {});
  const id = useId();
  return <div className="space-y-3">
    <form action={action} className="space-y-2">
      <Label htmlFor={`${id}-key`}>{hasKey ? "Replace OpenAI API key" : "OpenAI API key"}</Label>
      <Input id={`${id}-key`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required placeholder="sk-…" aria-describedby={`${id}-help`} />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">Checked with OpenAI, encrypted, and never shown again. Usage is billed to your OpenAI account.</p>
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
