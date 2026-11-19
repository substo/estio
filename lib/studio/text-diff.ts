export type DiffPart = { kind: "same" | "add" | "remove"; text: string };

/** Line-level diff (longest common subsequence) so a proposed change can be shown before it is applied. */
export function diffLines(before: string, after: string): DiffPart[] {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length * b.length > 250_000) return [...a.map(text => ({ kind: "remove" as const, text })), ...b.map(text => ({ kind: "add" as const, text }))];
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const parts: DiffPart[] = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { parts.push({ kind: "same", text: a[i]! }); i++; j++; }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) parts.push({ kind: "remove", text: a[i++]! });
    else parts.push({ kind: "add", text: b[j++]! });
  }
  while (i < a.length) parts.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) parts.push({ kind: "add", text: b[j++]! });
  return parts;
}
