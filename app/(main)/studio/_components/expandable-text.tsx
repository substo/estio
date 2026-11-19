"use client";
import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

/** Compact by default (three lines); the full original text is one click away and never altered. */
export function ExpandableText({ text, label = "Description", empty }: { text: string; label?: string; empty: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = text.length > 240 || text.split("\n").length > 3;
  if (!text.trim()) return <section aria-label={label} className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">{empty}</section>;
  return <section aria-label={label} className="rounded-xl bg-muted/50 p-4 text-sm">
    <p id={id} className={`whitespace-pre-wrap break-words leading-relaxed ${open ? "" : "line-clamp-3"}`}>{text}</p>
    {long ? <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-foreground hover:underline">{open ? "Show less" : "Show more"}<ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} /></button> : null}
  </section>;
}
