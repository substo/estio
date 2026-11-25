"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export type EvidenceMode = "automatic" | "selected" | "none";
export type EvidenceSourceFocus = { id: string; title: string };
type Choice = { id: string; statement: string; quote: string; title: string };

export function AgentEvidenceChoice({ recordId, sourceId, tenant, mode, selected, onMode, onSelected, disabled, focusedSource = null, onClearFocus }: {
  recordId: string | null; sourceId: string | null; tenant: string;
  mode: EvidenceMode; selected: string[]; onMode: (mode: EvidenceMode) => void;
  onSelected: (ids: string[]) => void; disabled: boolean;
  focusedSource?: EvidenceSourceFocus | null; onClearFocus?: () => void;
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const request = useRef(0);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const canChoose = Boolean(recordId || sourceId);
  const visible = (choices ?? []).filter(item => !query.trim() || `${item.title} ${item.statement} ${item.quote}`.toLowerCase().includes(query.trim().toLowerCase()));

  const load = useCallback(async (linkedId: string | null = null) => {
    const generation = ++request.current;
    setPending(true);
    setError("");
    try {
      const params = new URLSearchParams(recordId ? { evidenceRecord: recordId } : { evidenceSource: sourceId ?? "" });
      if (recordId && linkedId) params.set("evidenceLinkedSource", linkedId);
      const response = await fetch(`/studio/assistant/agent/api?${params}`, { headers: { "X-Studio-Tenant": tenant }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.choices)) throw new Error();
      const rows = data.choices as Choice[];
      if (generation !== request.current) return;
      setChoices(rows);
      setLoadedSource(linkedId);
    } catch {
      if (generation === request.current) setError("Could not load approved passages. Try refreshing.");
    } finally { if (generation === request.current) setPending(false); }
  }, [recordId, sourceId, tenant]);

  useEffect(() => {
    if (!focusedSource || !recordId) return;
    setQuery("");
    setChoices(null);
    if (details.current) {
      details.current.open = true;
      details.current.querySelector("summary")?.focus();
    }
    void load(focusedSource.id);
  }, [focusedSource, load, recordId]);

  return <details ref={details} className="text-xs">
    <summary className="cursor-pointer text-muted-foreground">Source evidence for this message · {
      mode === "automatic" ? "Automatic" : mode === "none" ? "None" : `${selected.length} selected`
    }</summary>
    <div className="mt-2 space-y-2">
      <label className="flex flex-wrap items-center gap-2">
        <span>Use source evidence</span>
        <select className="min-h-8 rounded-md border bg-background px-2" value={mode} disabled={disabled}
          onChange={event => {
            const next = event.target.value as EvidenceMode;
            onMode(next);
            if (next !== "selected" && focusedSource) { onClearFocus?.(); setChoices(null); ++request.current; setPending(false); }
            if (next === "selected" && !pending && (!choices || loadedSource !== (focusedSource?.id ?? null))) {
              setChoices(null);
              void load(focusedSource?.id);
            }
          }}>
          <option value="automatic">Automatic</option>
          <option value="selected" disabled={!canChoose}>Selected passages</option>
          <option value="none">No source evidence</option>
        </select>
      </label>
      {mode !== "automatic" ? <p className="text-muted-foreground">The assistant uses your message and current draft. Earlier chat and additional source reads are skipped for this message.</p> : null}
      {mode === "selected" ? <>
        {focusedSource ? <div className="flex flex-wrap items-center gap-2">
          <p>Passages from <strong>{focusedSource.title}</strong></p>
          <Button type="button" variant="ghost" size="sm" disabled={disabled}
            onClick={() => { onClearFocus?.(); setChoices(null); void load(); }}>Show all linked sources</Button>
        </div> : null}
        {pending ? <p role="status">Loading approved passages…</p> : null}
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {choices?.length ? <>
          <label className="block">Filter shown passages
            <input className="mt-1 block w-full rounded-md border bg-background p-1.5" type="search" value={query} onChange={event => setQuery(event.target.value)} />
          </label>
          {choices.length === 80 ? <p className="text-muted-foreground">Showing the first 80 approved passages.</p> : null}
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2" aria-label="Approved source passages">
            {visible.map(item => <li key={item.id}><label className="flex items-start gap-2">
              <input type="checkbox" checked={selected.includes(item.id)} disabled={disabled || pending || selected.length >= 4 && !selected.includes(item.id)}
                onChange={event => onSelected(event.target.checked ? [...selected, item.id] : selected.filter(id => id !== item.id))} />
              <span className="min-w-0 break-words"><strong>{item.statement}</strong><br /><span className="text-muted-foreground">{item.title} · “{item.quote}”</span></span>
            </label></li>)}
            {visible.length === 0 ? <li>No passages match this filter.</li> : null}
          </ul>
        </> : choices ? <p>{focusedSource ? "No approved passages are ready for this source. Review its saved transcript, approve findings, then refresh." : "No approved passages are available from this draft’s linked sources."}</p> : null}
        <div className="flex items-center gap-2">
          <p className="text-muted-foreground">{selected.length} of 4 selected</p>
          {selected.length ? <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onSelected([])}>Clear selection</Button> : null}
          <Button type="button" variant="ghost" size="sm" disabled={pending || disabled} onClick={() => void load(focusedSource?.id)}>Refresh passages</Button>
        </div>
      </> : null}
    </div>
  </details>;
}
