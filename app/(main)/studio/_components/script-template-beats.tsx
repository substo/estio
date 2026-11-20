import type { ScriptTemplateBeat } from "@/lib/studio/script-template-policy";

export function ScriptTemplateBeats({ beats }: { beats: readonly ScriptTemplateBeat[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {beats.map((beat, index) => (
        <li key={index}><strong>{beat.name}</strong><p className="whitespace-pre-wrap break-words text-muted-foreground">{beat.guidance}</p></li>
      ))}
    </ol>
  );
}
