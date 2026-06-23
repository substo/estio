export function appendAiStreamText(current: string, chunk: string) {
    const next = String(chunk || "");
    if (!next) return current;
    return current + next;
}
