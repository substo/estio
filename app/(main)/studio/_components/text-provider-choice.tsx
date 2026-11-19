"use client";
import { useEffect, useState } from "react";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import { useStudioTenantHeaders } from "./studio-tenant-context";
type Readiness = Record<StudioTextProvider, { ready: boolean; reason: string }>;
export function StudioTextProviderChoice({ provider, onChange, fullSource = false, videoTemplate = false, sourceAssist = false }: { provider: StudioTextProvider; onChange: (value: StudioTextProvider) => void; fullSource?: boolean; videoTemplate?: boolean; sourceAssist?: boolean }) {
  const headers = useStudioTenantHeaders();
  const tenant = headers["X-Studio-Tenant"];
  const [state, setState] = useState<Readiness | null>(null);
  useEffect(() => { const controller = new AbortController(); setState(null);
    void fetch(sourceAssist ? "/studio/ai-capabilities/api?workflow=source_assist" : videoTemplate ? "/studio/ai-capabilities/api?workflow=video_template" : fullSource ? "/studio/ai-capabilities/api?workflow=knowledge_outline" : "/studio/ai-capabilities/api", { headers: { "X-Studio-Tenant": tenant }, cache: "no-store", signal: controller.signal })
      .then(r => r.ok ? r.json() : null).then(setState).catch(() => {});
    return () => controller.abort();
  }, [tenant, fullSource, videoTemplate, sourceAssist]);
  return <div className="space-y-2">
    <label className="block space-y-1">Process with<select className="block w-full rounded-md border bg-background p-2" value={provider} onChange={e => onChange(e.target.value as StudioTextProvider)}>
      <option value="subscription">My paired Mac subscription</option><option value="openai">Location OpenAI API key (paid)</option>
    </select></label>
    <p role="status">{state?.[provider]?.reason ?? "Readiness is checked before queuing. Refresh this page after changing AI or Mac settings."}</p>
    <p className="text-muted-foreground">{provider === "subscription" ? "Uses your selected Codex or Claude subscription on your Mac. Text work, processing, sign-in and fresh capacity are required. No paid API fallback." : fullSource ? "Uses the Location key and budget. Each batch reserves $0.01 and settles metered usage. A full extraction can use up to 48 batches." : "Uses the Location key and budget. Reserves $0.01 and settles metered usage; uncertain outcomes retain the hold for manager review."}</p>
    <a className="underline" href={provider === "subscription" ? "/studio/settings/computer" : "/studio/settings/ai"}>Connection settings</a>
  </div>;
}
