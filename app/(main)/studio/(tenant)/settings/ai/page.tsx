import { studioRouteParams } from "@/lib/studio/route-context";
import { notFound } from "next/navigation";
import { formatUsd } from "@/lib/studio/ai-settings-policy";
import { getStudioAiSettings } from "@/lib/studio/ai-settings";
import { BudgetForm, OpenAiKeyForm } from "./ai-settings-forms";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StudioAiSettingsPage({ params }: { params: Promise<{  }> }) {
  const { locationId } = await studioRouteParams(params);
  const settings = await getStudioAiSettings(locationId);
  if (!settings) notFound();
  const { openai, monthlyBudgetMicros, spentMicros, heldMicros, canManage, encryptionReady } = settings;
  const active = Boolean(openai) && monthlyBudgetMicros > 0;
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">AI settings</h1>
        <p className="text-muted-foreground">Configure optional hosted processing for this Business.</p>
      </header>
      <p className="text-sm">To process on your own Mac instead, go to <Link className="text-primary hover:underline" href="/studio/settings/computer">Connected computer</Link>.</p>
      <section className="space-y-2 rounded-xl border bg-card p-5 text-sm">
        <h2 className="text-lg font-medium">Optional hosted API</h2>
        <p className="text-muted-foreground">Hosted transcription and AI processing use this Business&apos;s OpenAI API key and monthly cap. A key is not required for Mac checks. Adding a key does not enable automatic paid fallback for Mac jobs.</p>
        <p><span className="font-medium">Hosted API:</span> {active ? "Active" : "Paused"}{!openai ? " (no key)" : monthlyBudgetMicros === 0 ? " (cap is $0)" : ""}</p>
        <p><span className="font-medium">OpenAI key:</span> {openai ? `Saved, ending in …${openai.keyHint}` : "Not set"}</p>
        <p><span className="font-medium">This month (UTC):</span> {formatUsd(spentMicros)} spent{heldMicros ? `, ${formatUsd(heldMicros)} reserved for running work` : ""} of {formatUsd(monthlyBudgetMicros)}</p>
      </section>
      {canManage ? <>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">OpenAI key</h2>
          {encryptionReady ? <OpenAiKeyForm locationId={locationId} hasKey={Boolean(openai)} /> : <p className="text-sm text-muted-foreground">Secure key storage is not configured on this server yet.</p>}
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Spending cap</h2>
          <BudgetForm locationId={locationId} budgetUsd={(monthlyBudgetMicros / 1_000_000).toFixed(2)} />
        </section>
      </> : <p className="text-sm text-muted-foreground">Only a Business admin can change hosted API settings.</p>}
    </main>
  );
}
