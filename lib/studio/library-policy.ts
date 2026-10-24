export type LibraryKind = "reference" | "channel";
export interface LibraryDraft {
  kind: LibraryKind;
  title: string;
  payload: Record<string, string | boolean>;
}

export function safeStudioSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Only user-editable fields are patched; unknown imported evidence is retained. */
export function readLibraryDraft(form: FormData): LibraryDraft {
  const kind = String(form.get("kind") || "");
  const title = String(form.get("title") || "").trim();
  if (kind !== "reference" && kind !== "channel") throw new Error("Choose a library source or channel.");
  if (!title || title.length > 180) throw new Error("Enter a title up to 180 characters.");
  const payload: LibraryDraft["payload"] = { title };
  for (const field of ["url", "summary", "notes", "transcript", "platform"] as const) {
    // Absent fields must not clear existing evidence during a partial form edit.
    if (!form.has(field)) continue;
    const value = String(form.get(field) || "");
    const maximum = field === "transcript" ? 100_000 : 20_000;
    if (value.length > maximum) throw new Error(`${field} is too long.`);
    if (field === "url" && value.trim() && !safeStudioSourceUrl(value)) throw new Error("Source links must use HTTP or HTTPS and contain no credentials.");
    payload[field] = value;
  }
  for (const field of ["approved", "archived"] as const) {
    if (form.has(`${field}Present`)) payload[field] = form.get(field) === "on";
  }
  return { kind, title, payload };
}
