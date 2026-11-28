"use client";
const LINE = /^\[(\d\d):(\d\d):(\d\d)\]\s?(.*)$/;
/** A saved transcript as timestamped lines; each time links to that moment on YouTube. Plain text stays plain. */
export function TranscriptLines({ text, videoId }: { text: string; videoId?: string | null }) {
  const lines = text.split("\n"); const timed = lines.filter(l => LINE.test(l)).length > lines.length / 2;
  if (!timed) return <p id="saved-transcript" className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 text-sm leading-relaxed transition-shadow">{text}</p>;
  return <ol id="saved-transcript" className="max-h-[32rem] space-y-1 overflow-y-auto rounded-lg border bg-card p-4 text-sm leading-relaxed transition-shadow">
    {lines.map((line, i) => { const m = LINE.exec(line); if (!m) return line.trim() ? <li key={i} className="break-words">{line}</li> : null;
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); const label = Number(m[1]) ? `${m[1]}:${m[2]}:${m[3]}` : `${m[2]}:${m[3]}`;
      return <li key={i} className="flex gap-3"><span className="w-14 shrink-0 tabular-nums text-muted-foreground">{videoId ? <a href={`https://www.youtube.com/watch?v=${videoId}&t=${seconds}s`} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline" aria-label={`Open the video at ${label}`}>{label}</a> : label}</span><span className="break-words">{m[4]}</span></li>; })}
  </ol>;
}
