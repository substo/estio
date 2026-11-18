"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { StudioTextProviderChoice } from "../../../../_components/text-provider-choice";
import { useStudioCommand } from "../../../../_components/use-studio-command";

export function VideoTemplateStartForm({ sourceId, version }: { sourceId: string; version: number }) {
  const [provider, setProvider] = useState<StudioTextProvider>("subscription");
  const [confirmed, setConfirmed] = useState(false);
  const [queued, setQueued] = useState(false);
  const command = useStudioCommand("/studio/content/templates/from-video/api");
  const router = useRouter();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (queued || (!confirmed && !command.retry)) return;
    const result = await command.run({ requestId: crypto.randomUUID(), sourceId, expectedVersion: version, provider,
      confirmPaid: provider === "openai" && confirmed, confirmSubscription: provider === "subscription" && confirmed });
    if (result?.ok) {
      setQueued(true);
      router.push(`/studio/content/templates/from-video/${result.data.reviewId}`);
    }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-lg border p-4 text-sm">
    <fieldset className="space-y-3" disabled={command.pending || command.retry || queued}>
      <StudioTextProviderChoice videoTemplate provider={provider} onChange={value => { setProvider(value); setConfirmed(false); }} />
      <label className="flex items-start gap-2"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        {provider === "subscription" ? "I authorize processing using my paired Mac subscription." : "I authorize paid processing using the Location OpenAI API key."}
      </label>
    </fieldset>
    <button disabled={command.pending || queued || (!confirmed && !command.retry)} className="rounded-md border px-3 py-2 disabled:opacity-50">
      {queued ? "Queued" : command.pending ? "Queuing…" : command.retry ? "Retry same request" : "Extract script template"}
    </button>
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </form>;
}
