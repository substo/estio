/**
 * A2UI-style declarative UI for the Studio agent chats. The model may end its reply text with ONE fenced block
 * ```a2ui {"components":[...]}``` naming components from a closed catalog. This parser is the only gate: it validates
 * shape and length, drops unknown components, and never passes HTML, URLs, styles or code through. Anything invalid
 * degrades to the plain reply text. User actions go back as an ordinary chat message (see a2uiActionMessage).
 */
export type A2uiComponent =
  | { type: "choices"; prompt: string | null; options: string[] }
  | { type: "form"; title: string | null; submit: string; fields: Array<{ name: string; label: string; options: string[] }> }
  | { type: "checklist"; title: string | null; submit: string; items: string[] }
  | { type: "cards"; title: string | null; items: Array<{ title: string; body: string | null; action: string | null }> }
  | { type: "confirm"; title: string; approve: string; decline: string };
export type A2uiParsed = { text: string; components: A2uiComponent[] };

const FENCE = /```a2ui\s*([\s\S]*?)```/;
const str = (v: unknown, max: number) => typeof v === "string" && v.trim() && v.length <= max && !v.includes("\0") ? v.trim() : null;
const opt = (v: unknown, max: number) => (v === undefined || v === null ? null : str(v, max));
const list = (v: unknown, max: number, len: number) => Array.isArray(v) && v.length > 0 && v.length <= max ? v.map(item => str(item, len)) : null;
const clean = <T,>(items: Array<T | null> | null): T[] | null => items && items.every(item => item !== null) ? items as T[] : null;
const obj = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;

function component(raw: unknown): A2uiComponent | null {
  const c = obj(raw); if (!c) return null;
  if (c.type === "choices") { const options = clean(list(c.options, 6, 80)); return options ? { type: "choices", prompt: opt(c.prompt, 160), options } : null; }
  if (c.type === "confirm") { const title = str(c.title, 200); return title ? { type: "confirm", title, approve: opt(c.approve, 30) ?? "Approve", decline: opt(c.decline, 30) ?? "Not now" } : null; }
  if (c.type === "checklist") { const items = clean(list(c.items, 8, 120)); return items ? { type: "checklist", title: opt(c.title, 120), submit: opt(c.submit, 30) ?? "Send", items } : null; }
  if (c.type === "form") {
    if (!Array.isArray(c.fields) || !c.fields.length || c.fields.length > 4) return null;
    const fields = c.fields.map(raw => { const f = obj(raw); const name = f && str(f.name, 40); const label = f && str(f.label, 80);
      const options = f && f.options !== undefined ? clean(list(f.options, 8, 60)) : [];
      return name && label && options ? { name, label, options } : null; });
    return fields.every(Boolean) ? { type: "form", title: opt(c.title, 120), submit: opt(c.submit, 30) ?? "Send", fields: fields as Array<{ name: string; label: string; options: string[] }> } : null;
  }
  if (c.type === "cards") {
    if (!Array.isArray(c.items) || !c.items.length || c.items.length > 5) return null;
    const items = c.items.map(raw => { const i = obj(raw); const title = i && str(i.title, 100); return title ? { title, body: opt(i.body, 300), action: opt(i.action, 30) } : null; });
    return items.every(Boolean) ? { type: "cards", title: opt(c.title, 120), items: items as Array<{ title: string; body: string | null; action: string | null }> } : null;
  }
  return null; // unknown component: dropped
}

export function parseA2ui(reply: string): A2uiParsed {
  const match = FENCE.exec(reply);
  if (!match) return { text: reply, components: [] };
  const text = reply.replace(FENCE, "").trim();
  let data: unknown; try { data = JSON.parse(match[1]); } catch { return { text, components: [] }; }
  const list = obj(data)?.components;
  const components = Array.isArray(list) ? list.slice(0, 4).map(component).filter((c): c is A2uiComponent => c !== null) : [];
  return { text, components };
}

/** The structured message a user action sends back; plain text so history, limits and routing stay unchanged. */
export const a2uiActionMessage = (kind: string, values: Record<string, string> | string[] | string): string =>
  `[A2UI ${kind}] ${typeof values === "string" ? values : Array.isArray(values) ? values.join("; ") : Object.entries(values).map(([k, v]) => `${k}: ${v}`).join("; ")}`.slice(0, 1000);
