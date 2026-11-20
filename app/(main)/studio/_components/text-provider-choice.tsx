"use client";
import { useEffect, useId, useState } from "react";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { useStudioTenantHeaders } from "./studio-tenant-context";
type Readiness = Record<StudioTextProvider, { ready: boolean; reason: string; label?: string }>;
export function StudioTextProviderChoice({ provider, onChange, fullSource = false, videoTemplate = false, sourceAssist = false, selectedIdea = false, stagedCreation = false, compact = false }: { provider: StudioTextProvider; onChange: (value: StudioTextProvider) => void; fullSource?: boolean; videoTemplate?: boolean; sourceAssist?: boolean; selectedIdea?: boolean; stagedCreation?: boolean; compact?: boolean }) {
  const selectId = useId();
  const headers = useStudioTenantHeaders();
  const tenant = headers["X-Studio-Tenant"];
  const [state, setState] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { const controller = new AbortController(); setState(null); setFailed(false);
    void fetch(stagedCreation ? "/studio/ai-capabilities/api?workflow=staged_creation" : selectedIdea ? "/studio/ai-capabilities/api?workflow=selected_idea" : sourceAssist ? "/studio/ai-capabilities/api?workflow=source_assist" : videoTemplate ? "/studio/ai-capabilities/api?workflow=video_template" : fullSource ? "/studio/ai-capabilities/api?workflow=knowledge_outline" : "/studio/ai-capabilities/api", { headers: { "X-Studio-Tenant": tenant }, cache: "no-store", signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error("unavailable"))).then(setState).catch(error => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [tenant, fullSource, videoTemplate, sourceAssist, selectedIdea, stagedCreation]);
  const choices = <>
    <option value="location_order">Location AI order</option>
    <option value="subscription">{state?.subscription.label ?? "My paired Mac subscription"}</option>
    <option value="openai">{state?.openai.label ?? "Location OpenAI API (paid)"}</option>
  </>;
  const status = state?.[provider]?.reason ?? (failed ? "Could not check readiness. The server will check when you submit." : "Checking readiness…");
  if (compact) return <div className="flex flex-wrap items-center gap-2 text-xs">
    <label className="sr-only" htmlFor={selectId}>Process with</label>
    <select id={selectId} className="min-h-9 max-w-full rounded-md border bg-background px-2 text-xs" value={provider}
      onChange={e => onChange(e.target.value as StudioTextProvider)}>{choices}</select>
    <span role="status" className={state?.[provider]?.ready === false ? "text-destructive" : "text-muted-foreground"}>{status}</span>
  </div>;
  return <div className="space-y-2">
    <label className="block space-y-1">Process with<select className="block w-full rounded-md border bg-background p-2" value={provider}
      onChange={e => onChange(e.target.value as StudioTextProvider)}>{choices}</select></label>
    <p role="status">{status}</p>
    <p className="text-muted-foreground">{provider === "location_order"
      ? "Follows the order set by a Location admin. A paid step uses the Location budget."
      : provider === "subscription"
        ? "Uses the model selected in Connected computer settings."
        : fullSource
          ? "Each batch reserves $0.01 and settles metered usage. A full extraction can use up to 48 batches."
          : "Reserves $0.01 and settles metered usage. An uncertain outcome retains the hold for review."}</p>
    <a className="underline" href={provider === "subscription" ? "/settings/computer?from=studio" : "/settings/ai?from=studio"}>Connection settings</a>
  </div>;
}
