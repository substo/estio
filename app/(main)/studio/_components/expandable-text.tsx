"use client";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/** One quiet row. The chevron opens the untouched original text; nothing is shown until asked. */
export function ExpandableText({ text, label = "Description", empty }: { text: string; label?: string; empty: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text.trim()) return <p className="text-xs text-muted-foreground">{label}: {empty}</p>;
  return <section aria-label={label} className="rounded-lg border bg-muted/30">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="flex min-h-9 w-full items-center justify-between gap-2 px-3 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">
      {label}<ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>
    <p id={id} hidden={!open} className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 text-sm leading-relaxed">{text}</p>
  </section>;
}
