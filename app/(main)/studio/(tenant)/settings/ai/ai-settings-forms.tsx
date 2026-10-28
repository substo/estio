"use client";
import { useActionState } from "react";
import { removeOpenAiKeyAction, saveBudgetAction, saveOpenAiKeyAction } from "./actions";

const inputClass = "mt-1 w-full rounded-md border bg-background p-2";
const buttonClass = "rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50";
function Status({ state }: { state: { error?: string; saved?: string } }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  return state.saved ? <p role="status" className="text-sm text-muted-foreground">{state.saved}</p> : null;
}

export function OpenAiKeyForm({ locationId, hasKey }: { locationId: string; hasKey: boolean }) {
  const [state, action, pending] = useActionState(saveOpenAiKeyAction.bind(null, locationId), {});
  const [removeState, remove, removing] = useActionState(removeOpenAiKeyAction.bind(null, locationId), {});
  return <div className="space-y-3">
    <form action={action} className="space-y-3">
      <label className="block text-sm">{hasKey ? "Replace OpenAI API key" : "OpenAI API key"}
        <input name="apiKey" type="password" autoComplete="off" spellCheck={false} required placeholder="sk-…" className={inputClass} /></label>
      <p className="text-xs text-muted-foreground">The key is checked with OpenAI, encrypted, and never shown again. Usage is billed to your OpenAI account.</p>
      <Status state={state} />
      <button disabled={pending} className={buttonClass}>{pending ? "Checking…" : "Save key"}</button>
    </form>
    {hasKey ? <form action={remove}><Status state={removeState} /><button disabled={removing} className="text-sm text-destructive hover:underline disabled:opacity-50">{removing ? "Removing…" : "Remove key"}</button></form> : null}
  </div>;
}

export function BudgetForm({ locationId, budgetUsd }: { locationId: string; budgetUsd: string }) {
  const [state, action, pending] = useActionState(saveBudgetAction.bind(null, locationId), {});
  return <form action={action} className="space-y-3">
    <label className="block text-sm">Monthly spending cap (US dollars)
      <input name="monthlyBudget" inputMode="decimal" required defaultValue={budgetUsd} className={inputClass} /></label>
    <p className="text-xs text-muted-foreground">Hosted AI work stops for the month when the cap is reached. Set 0 to pause all hosted AI spend.</p>
    <Status state={state} />
    <button disabled={pending} className={buttonClass}>{pending ? "Saving…" : "Save cap"}</button>
  </form>;
}
