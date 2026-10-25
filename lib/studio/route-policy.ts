/** Only known Studio resource sections can be carried through legacy links. */
const SECTIONS = new Set(["library", "content", "knowledge", "jobs", "schedules", "settings", "uploads", "youtube", "media", "records", "knowledge-media"]);
export function cleanStudioLegacyPath(path: string[] = []): string | null {
  if (path.length && !SECTIONS.has(path[0])) return null;
  if (path.some((part) => !part || part === "." || part === ".." || /[\\/\x00-\x20]/.test(part))) return null;
  return "/studio" + (path.length ? "/" + path.map(encodeURIComponent).join("/") : "");
}
