"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { studioTextConsent } from "@/lib/studio/text-provider";
import type { ExtractionInputs } from "@/lib/studio/knowledge-extraction";
import { useStudioCommand } from "./use-studio-command";

export function SourceKnowledgeActions({ evidence, auto, outlinePending, allowExtract, setupFailed }: {
  evidence: ExtractionInputs | null; auto: { status: string; error: string | null } | null;
  outlinePending: boolean; allowExtract: boolean; setupFailed: boolean;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(0);
  const [waitingForOutline, setWaitingForOutline] = useState(false);
  const command = useStudioCommand("/studio/knowledge/extractions/api");
  const input = evidence?.inputs[choice] ?? evidence?.inputs[0];
  const autoPending = auto?.status === "queued" || auto?.status === "running";
  const waiting = autoPending || waitingForOutline;
  const busy = waiting || outlinePending || command.pending;
  const failure = auto && ["failed", "cancelled", "dead"].includes(auto.status)
    ? auto.error || "Automatic extraction stopped. You can start it here."
    : null;

  useEffect(() => {
    if (outlinePending) setWaitingForOutline(false);
  }, [outlinePending]);
  useEffect(() => {
    if (!waiting) return;
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(refresh, 4000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [waiting, router]);
  useEffect(() => {
    if (!waitingForOutline) return;
    const timer = setTimeout(() => setWaitingForOutline(false), 15_000);
    return () => clearTimeout(timer);
  }, [waitingForOutline]);

  async function extract() {
    if (!evidence || !input || busy) return;
    const result = await command.run({ action: "enqueueOutline", requestId: crypto.randomUUID(),
      sourceId: evidence.source.id, expectedVersion: Number(evidence.source.version), inputId: input.inputId,
      mode: input.mode, ...studioTextConsent("subscription", true) });
    if (result?.ok) {
      setWaitingForOutline(true);
      const url = new URL(window.location.href);
      const outlineId = result.data?.outlineId;
      if (url.searchParams.has("knowledgeReview") && typeof outlineId === "string" && recordLinkId(outlineId)) {
        url.searchParams.set("knowledgeReview", outlineId);
        router.replace(`${url.pathname}${url.search}#knowledge`, { scroll: false });
      } else router.refresh();
    } else if (result?.status === 409) router.refresh();
  }

  const status = busy && !outlinePending ? autoPending ? auto.error || "Preparing knowledge extraction…" : "Starting knowledge extraction…" : null;
  return <div className="space-y-2">
    {status ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />{status}
    </p> : null}
    {command.error || failure || (setupFailed && !auto && allowExtract) ? <p role="alert" className="text-sm text-destructive">
      {command.error || failure || "Automatic extraction couldn’t start. You can start it here."}
    </p> : null}
    {allowExtract && !outlinePending && !waiting ? input ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" className="min-h-11" disabled={command.pending} onClick={() => void extract()}>
        {command.pending ? "Queuing…" : command.retry ? "Retry request" : "Extract knowledge"}
      </Button>
      {evidence && evidence.inputs.length > 1 ? <select aria-label="Evidence to extract" value={choice} disabled={command.pending || command.retry}
        onChange={event => setChoice(Number(event.target.value))} className="min-h-11 w-full min-w-0 rounded-md border bg-background px-2 text-sm sm:w-auto sm:max-w-full">
        {evidence.inputs.map((item, index) => <option key={`${item.mode}:${item.inputId}`} value={index}>{item.label}</option>)}
      </select> : null}
      <span className="text-xs text-muted-foreground">Uses your paired Mac subscription</span>
    </div> : !failure ? <p className="text-sm text-muted-foreground">Knowledge needs a saved transcript or description.</p> : null : null}
  </div>;
}
