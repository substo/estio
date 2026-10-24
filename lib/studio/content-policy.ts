export const CONTENT_STAGES = ["idea", "research", "script", "record", "edit", "cover", "ready"] as const;
export const CONTENT_LEVELS = ["discover", "consider", "decide", "retain"] as const;
export type ContentStage = typeof CONTENT_STAGES[number];
export type ContentLevel = typeof CONTENT_LEVELS[number];
export type ContentPayloadPatch = Record<string, string | number | boolean | null>;
export interface ContentDraft { kind: "content"; title: string; payload: ContentPayloadPatch; }

export function contentStageForDisplay(value: unknown): ContentStage | "unclassified" {
  return CONTENT_STAGES.includes(value as ContentStage) ? value as ContentStage : "unclassified";
}

/** Known editing fields only; citations, links and unknown imported fields stay intact. */
export function readContentDraft(form: FormData): ContentDraft {
  const title = String(form.get("title") || "").trim();
  if (!title || title.length > 180) throw new Error("Enter a title up to 180 characters.");
  const payload: ContentPayloadPatch = { title };
  for (const field of ["summary", "notes", "script"] as const) {
    if (!form.has(field)) continue;
    const value = String(form.get(field) || "");
    if (value.length > (field === "script" ? 100_000 : 20_000)) throw new Error(`${field} is too long.`);
    payload[field] = value;
  }
  if (form.has("stage")) {
    const stage = String(form.get("stage") || "");
    if (!CONTENT_STAGES.includes(stage as ContentStage)) throw new Error("Choose a valid content stage.");
    payload.stage = stage;
  }
  if (form.has("level")) {
    const level = String(form.get("level") || "");
    if (!CONTENT_LEVELS.includes(level as ContentLevel)) throw new Error("Choose a valid audience stage.");
    payload.level = level;
  }
  if (form.has("pillar")) {
    const pillar = String(form.get("pillar") || "");
    if (pillar !== "" && !/^[1-4]$/.test(pillar)) throw new Error("Choose a pillar from 1 to 4, or leave it unset.");
    payload.pillar = pillar ? Number(pillar) : null;
  }
  for (const field of ["approved", "archived"] as const) {
    if (form.has(`${field}Present`)) payload[field] = form.get(field) === "on";
  }
  return { kind: "content", title, payload };
}

/** Called with the authorized workspace ID, never a free-form browser filter. */
export function contentListQuery(workspaceId: string, showArchived: boolean): Record<string, string> {
  return {
    select: "id,title,version,updated_at,summary,approved,archived,stage:payload->>stage,level:payload->>level,pillar:payload->pillar",
    workspace_id: `eq.${workspaceId}`,
    kind: "eq.content",
    order: "updated_at.desc,id.asc",
    ...(showArchived ? {} : { archived: "eq.false" }),
  };
}


export type ContentStageFilter = ContentStage | "unclassified" | "all";
export interface ContentFilters { search: string; showArchived: boolean; stage: ContentStageFilter; }

export function contentStageLabel(stage: ContentStage | "unclassified"): string {
  return stage === "unclassified" ? "Needs classification" : stage[0].toUpperCase() + stage.slice(1);
}

export function readContentFilters(query: { q?: string | string[]; archived?: string | string[]; stage?: string | string[] }): ContentFilters {
  return {
    search: typeof query.q === "string" ? query.q.trim().slice(0, 200) : "",
    showArchived: query.archived === "1",
    stage: typeof query.stage === "string" && (query.stage === "unclassified" || CONTENT_STAGES.includes(query.stage as ContentStage))
      ? query.stage as ContentStageFilter : "all",
  };
}

/** Apply display filters to authorized summaries, retaining exact rows/order. */
export function filterContentSummaries<T extends { title: string; summary: string | null; stage: unknown }>(
  records: readonly T[], filters: Pick<ContentFilters, "stage" | "search">,
): T[] {
  const search = filters.search.toLowerCase();
  return records.filter(record => (filters.stage === "all" || contentStageForDisplay(record.stage) === filters.stage)
    && (!search || `${record.title}\n${record.summary || ""}`.toLowerCase().includes(search)));
}
