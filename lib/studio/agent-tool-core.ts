import { AGENT_SKILL_REGISTRY } from "./agent-skills";
import { AGENT_TOOLS, type AgentItem, type AgentObservation, type AgentToolCall } from "./agent-policy";

/** Data the tools may read. The server binds every method to the caller's Location and the draft's linked sources. */
export type AgentToolData = {
  sources: Array<{ id: string; title: string; text: string; version: number }>;
  stageText(stage: string): string;
  findings(sourceId: string | null, limit: number): Promise<Array<{ evidenceId: string; statement: string; quote: string; start: number | null; sourceId: string; title: string }>>;
  library(limit: number): Promise<Array<{ id: string; title: string; description: string }>>;
  /** Approved, current Knowledge across every live saved source in the Location whose statement, quote or source title contains any pattern. */
  knowledge(patterns: string[], limit: number): Promise<Array<{ evidenceId: string; statement: string; quote: string; start: number | null; sourceId: string; title: string }>>;
};
const OBSERVATION_BYTES = 4400;
const WINDOW = 420;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const terms = (query: string | null) => [...new Set((query ?? "").toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(word => word.length >= 3))].slice(0, 6);
const short = (id: string) => id.slice(0, 8);

/** Shows whole words at both ends of an excerpt. The text stays an exact substring of the saved text and `start` is its real offset. */
export function snapWindow(text: string, start: number, length: number) {
  const word = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}']/u.test(char);
  let from = start;
  if (from > 0 && word(text[from - 1]) && word(text[from])) {
    let next = from; while (next < text.length && next - from < 40 && word(text[next])) next++;
    if (next - from < 40) from = next;
  }
  let to = Math.min(text.length, start + length);
  if (to < text.length && word(text[to - 1]) && word(text[to])) {
    let back = to; while (back > from && to - back < 40 && word(text[back - 1])) back--;
    if (to - back < 40 && back > from) to = back;
  }
  while (from < to && /\s/.test(text[from])) from++;
  return { start: from, text: text.slice(from, to).trimEnd() };
}

/** Highest-scoring non-overlapping passages; an empty query samples opening, middle and end. */
export function findPassages(text: string, query: string | null, count = 4) {
  if (!text) return [];
  const wanted = terms(query);
  if (!wanted.length) {
    const starts = [0, Math.max(0, Math.floor(text.length / 2 - WINDOW / 2)), Math.max(0, text.length - WINDOW)];
    return [...new Set(starts)].slice(0, 3).map(start => snapWindow(text, start, WINDOW));
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
  return chosen.sort((a, b) => a - b).map(start => snapWindow(text, start, WINDOW));
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
  // search_knowledge is v4-only; the server never executes it for a round stamped under an older contract (see agent.ts).
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
      const window = snapWindow(source.text, start, 1200);
      const text = window.text;
      return fit({ items: [{ id: `${short(source.id)}:${window.start}`, label: `${source.title} · characters ${window.start}–${window.start + text.length} of ${source.text.length}`, text, sourceId: source.id, cite: true }], untrusted: true });
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
      if (!text) return fit({ items: [{ id: `stage:${call.stage}`, label: `Current ${call.stage}`, text: "This stage is empty.", cite: false }], untrusted: true });
      // Long scripts are read in windows: pass the offset of the next window to continue.
      const from = Math.min(call.offset ?? 0, Math.max(0, text.length - 1));
      const window = text.slice(from, from + 2800);
      return fit({ items: [{ id: `stage:${call.stage}:${from}`, label: `Current ${call.stage} · characters ${from}–${from + window.length} of ${text.length}`, text: window, cite: false }], untrusted: true,
        ...(from + window.length < text.length ? { note: `More text follows: read_stage again with offset ${from + window.length}.` } : {}) });
    }
    case "search_knowledge": {
      const wanted = terms(call.query);
      if (!wanted.length) return fail("Give a short phrase to search saved Knowledge.");
      const rows = await data.knowledge(wanted.map(term => `%${term}%`), 60);
      const linked = new Set(data.sources.map(source => source.id));
      const score = (row: { statement: string; quote: string; title: string }) => wanted.reduce((sum, term) => sum + (`${row.statement} ${row.quote}`.toLowerCase().includes(term) ? 2 : row.title.toLowerCase().includes(term) ? 1 : 0), 0);
      const perSource = new Map<string, number>();
      const items: AgentItem[] = [];
      for (const row of [...rows].sort((a, b) => score(b) - score(a))) {
        // Breadth over depth: at most two findings per source, six in total.
        if (items.length >= 6 || (perSource.get(row.sourceId) ?? 0) >= 2) continue;
        perSource.set(row.sourceId, (perSource.get(row.sourceId) ?? 0) + 1);
        items.push({ id: `k:${row.evidenceId}`, label: `${row.title} — ${row.statement}`, sourceId: row.sourceId, at: row.start, cite: true,
          text: `From “${row.title}”${linked.has(row.sourceId) ? " (linked to this draft)" : " (another saved source)"}\nApproved takeaway: ${row.statement}\nExact saved quote: “${row.quote}”` });
      }
      return fit({ items, untrusted: true, note: items.length ? "Approved Knowledge from saved sources: evidence of what each speaker said, not facts about the owner's product." : "No approved Knowledge matched. Nothing from related videos has been saved or read yet." });
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
