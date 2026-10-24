import { notFound } from "next/navigation";
import { formatUsd } from "@/lib/studio/ai-settings-policy";
import { getStudioAiSettings } from "@/lib/studio/ai-settings";
import { BudgetForm, OpenAiKeyForm } from "./ai-settings-forms";

export const dynamic = "force-dynamic";

export default async function StudioAiSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const settings = await getStudioAiSettings(workspaceId);
  if (!settings) notFound();
  const { openai, monthlyBudgetMicros, spentMicros, heldMicros, canManage, encryptionReady } = settings;
  const active = Boolean(openai) && monthlyBudgetMicros > 0;
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">AI settings</h1>
        <p className="text-muted-foreground">Hosted transcription and AI processing use this workspace&apos;s own OpenAI key, within its monthly cap.</p>
      </header>
      <section className="space-y-2 rounded-xl border bg-card p-5 text-sm">
        <p><span className="font-medium">Status:</span> {active ? "Active" : "Paused"}{!openai ? " (no key)" : monthlyBudgetMicros === 0 ? " (cap is $0)" : ""}</p>
        <p><span className="font-medium">OpenAI key:</span> {openai ? `Saved, ending in …${openai.keyHint}` : "Not set"}</p>
        <p><span className="font-medium">This month (UTC):</span> {formatUsd(spentMicros)} spent{heldMicros ? `, ${formatUsd(heldMicros)} reserved for running work` : ""} of {formatUsd(monthlyBudgetMicros)}</p>
      </section>
      {canManage ? <>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">OpenAI key</h2>
          {encryptionReady ? <OpenAiKeyForm workspaceId={workspaceId} hasKey={Boolean(openai)} /> : <p className="text-sm text-muted-foreground">Secure key storage is not configured on this server yet.</p>}
        </section>
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-medium">Spending cap</h2>
          <BudgetForm workspaceId={workspaceId} budgetUsd={(monthlyBudgetMicros / 1_000_000).toFixed(2)} />
        </section>
      </> : <p className="text-sm text-muted-foreground">Only a workspace owner or admin can change these settings.</p>}
    </main>
  );
}
