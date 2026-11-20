"use client";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Secondary explanation lives behind an info icon (hover/tap/keyboard) instead of sentences in the layout. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild><button type="button" aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Info aria-hidden="true" className="h-4 w-4" /></button></PopoverTrigger>
    <PopoverContent className="w-72 text-xs leading-relaxed">{children}</PopoverContent>
  </Popover>;
}
