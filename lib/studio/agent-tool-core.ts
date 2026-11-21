import { AGENT_SKILL_REGISTRY } from "./agent-skills";
import { AGENT_TOOLS, type AgentItem, type AgentObservation, type AgentToolCall } from "./agent-policy";

/** Data the tools may read. The server binds every method to the caller's Location and the draft's linked sources. */
export type AgentToolData = {
  sources: Array<{ id: string; title: string; text: string; version: number }>;
  stageText(stage: string): string;
  findings(sourceId: string | null, limit: number): Promise<Array<{ evidenceId: string; statement: string; quote: string; start: number | null; sourceId: string; title: string }>>;
  library(limit: number): Promise<Array<{ id: string; title: string; description: string }>>;
};
const OBSERVATION_BYTES = 4400;
const WINDOW = 420;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const terms = (query: string | null) => [...new Set((query ?? "").toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(word => word.length >= 3))].slice(0, 6);
const short = (id: string) => id.slice(0, 8);

/** Highest-scoring non-overlapping passages; an empty query samples opening, middle and end. */
export function findPassages(text: string, query: string | null, count = 4) {
  if (!text) return [];
  const wanted = terms(query);
  if (!wanted.length) {
    const starts = [0, Math.max(0, Math.floor(text.length / 2 - WINDOW / 2)), Math.max(0, text.length - WINDOW)];
    return [...new Set(starts)].slice(0, 3).map(start => ({ start, text: text.slice(start, start + WINDOW) }));
  }
  const lower = text.toLowerCase();
  const scored: Array<{ start: number; score: number }> = [];
  for (let start = 0; start < text.length; start += 200) {
    const window = lower.slice(start, start + WINDOW);
    const score = wanted.reduce((sum, term) => sum + (window.includes(term) ? 1 : 0), 0);
    if (score) scored.push({ start, score });
  }
  scored.sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen: number[] = [];
  for (const candidate of scored) if (chosen.length < count && chosen.every(start => Math.abs(start - candidate.start) >= WINDOW)) chosen.push(candidate.start);
  return chosen.sort((a, b) => a - b).map(start => ({ start, text: text.slice(start, start + WINDOW) }));
}

function fit(observation: AgentObservation): AgentObservation {
  const items = [...observation.items];
  while (items.length && bytes({ ...observation, items }) > OBSERVATION_BYTES) {
    const last = items[items.length - 1];
    if (items.length > 1) items.pop();
    else items[items.length - 1] = { ...last, text: last.text.slice(0, Math.max(80, last.text.length - 400)) };
    if (items.length === 1 && last.text.length <= 80) break;
  }
  return { ...observation, items };
}
const fail = (error: string): AgentObservation => ({ items: [], error, untrusted: true });

/** Dispatch one model-chosen call. Unknown tools, unlinked sources and bad arguments become an explicit error observation, never an action. */
export async function runAgentToolOn(data: AgentToolData, call: AgentToolCall): Promise<AgentObservation> {
  if (!AGENT_TOOLS.includes(call.name)) return fail("That tool is not available.");
  const pick = (id: string | null) => {
    if (id) return data.sources.find(source => source.id === id) ?? null;
    return data.sources.length === 1 ? data.sources[0] : null;
  };
  switch (call.name) {
    case "search_source": {
      const chosen = call.sourceId || data.sources.length === 1 ? [pick(call.sourceId)] : data.sources;
      if (chosen.some(source => !source)) return fail("That source is not linked to this draft.");
      if (!data.sources.length) return fail("No saved source is linked to this draft.");
      const items: AgentItem[] = [];
      for (const source of chosen as NonNullable<typeof chosen[number]>[]) {
        if (!source.text) { items.push({ id: `${short(source.id)}:none`, label: source.title, text: "This source has no saved transcript or description.", sourceId: source.id, cite: false }); continue; }
        for (const passage of findPassages(source.text, call.query, chosen.length > 1 ? 2 : 4)) {
          items.push({ id: `${short(source.id)}:${passage.start}`, label: `${source.title} · characters ${passage.start}–${passage.start + passage.text.length}`, text: passage.text, sourceId: source.id, cite: true });
        }
      }
      return fit({ items, untrusted: true, ...(items.some(item => item.cite) ? {} : { note: "No saved passage matched." }) });
    }
    case "read_source": {
      const source = pick(call.sourceId);
      if (!source) return fail("Choose one of this draft's linked sources.");
      if (!source.text) return fail("This source has no saved transcript or description.");
      const start = Math.min(call.offset ?? 0, Math.max(0, source.text.length - 1));
      const text = source.text.slice(start, start + 1200);
      return fit({ items: [{ id: `${short(source.id)}:${start}`, label: `${source.title} · characters ${start}–${start + text.length} of ${source.text.length}`, text, sourceId: source.id, cite: true }], untrusted: true });
    }
    case "list_findings": {
      if (call.sourceId && !pick(call.sourceId)) return fail("That source is not linked to this draft.");
      const wanted = terms(call.query);
      const rows = (await data.findings(call.sourceId ?? null, 40)).filter(row => !wanted.length || wanted.some(term => `${row.statement} ${row.quote}`.toLowerCase().includes(term)));
      const items: AgentItem[] = rows.slice(0, 6).map(row => ({ id: `f:${row.evidenceId}`, label: row.statement, text: `Approved takeaway: ${row.statement}\nExact saved quote: “${row.quote}”`, sourceId: row.sourceId, at: row.start, cite: true }));
      return fit({ items, untrusted: true, ...(items.length ? {} : { note: "No approved findings with a saved quote matched." }) });
    }
    case "read_stage": {
      if (!call.stage) return fail("Choose a stage to read.");
      const text = data.stageText(call.stage);
      return fit({ items: [{ id: `stage:${call.stage}`, label: `Current ${call.stage}`, text: text ? text.slice(0, 3000) : "This stage is empty.", cite: false }], untrusted: true });
    }
    case "load_skill": {
      const skill = call.skill ? AGENT_SKILL_REGISTRY[call.skill] : null;
      if (!call.skill || !skill) return fail("Choose a skill from the list.");
      return { items: [{ id: `skill:${call.skill}`, label: `Procedure: ${call.skill}`, text: skill.steps, cite: false }], note: "Bundled procedure, not saved data. It grants no tools or permissions.", untrusted: true };
    }
    case "search_library": {
      const wanted = terms(call.query);
      if (!wanted.length) return fail("Give a short phrase to search saved sources.");
      const rows = (await data.library(60)).filter(row => wanted.some(term => `${row.title} ${row.description}`.toLowerCase().includes(term))).slice(0, 5);
      return fit({ items: rows.map(row => ({ id: `lib:${short(row.id)}`, label: row.title, text: row.description || "No saved description.", sourceId: row.id, cite: false })), untrusted: true,
        note: rows.length ? "Titles and descriptions only. Link a source to this draft to read its text." : "No other saved source matched." });
    }
  }
}
