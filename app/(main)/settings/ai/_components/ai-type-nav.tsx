"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Settings → AI, by what is being made. Every provider key and every "which model or provider for this" choice is on one of these pages. */
export const AI_TYPES = [
  { href: "/settings/ai/connections", label: "Connections", hint: "Every platform and its API key" },
  { href: "/settings/ai", label: "Text and reasoning", hint: "Connections, models, fallback order and limits" },
  { href: "/settings/ai/voice", label: "Voice", hint: "Narration providers" },
  { href: "/settings/ai/audio", label: "Music and sound effects", hint: "Where audio is made, and its providers" },
  { href: "/settings/ai/images", label: "Images", hint: "Storyboard frames: platforms, keys and models" },
  { href: "/settings/ai/character", label: "Character", hint: "Your photos and the character card every storyboard frame is drawn from" },
] as const;

export function AiTypeNav() {
  const pathname = usePathname();
  return <nav aria-label="AI settings by type" className="flex flex-wrap gap-1 border-b pb-2">
    {AI_TYPES.map(t => { const on = pathname === t.href; return <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} title={t.hint}
      className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{t.label}</Link>; })}
  </nav>;
}
