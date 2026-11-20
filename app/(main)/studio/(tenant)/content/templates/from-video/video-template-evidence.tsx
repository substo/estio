import { evidenceTime } from "@/lib/studio/knowledge-outline";
import type { VideoTemplateResult, VideoTemplateSnapshot } from "@/lib/studio/video-template-policy";

export function VideoTemplateEvidence({ result, snapshot }: { result: VideoTemplateResult; snapshot: VideoTemplateSnapshot }) {
  const units = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const { coverage } = snapshot;
  return <section aria-label="Source evidence" className="space-y-3 rounded-lg border p-4 text-sm">
    <h2 className="font-medium">Source evidence and rationale</h2>
    <p className="text-muted-foreground">{coverage.selectedSpeech} of {coverage.speechUnits} timestamped speech passages
      {coverage.ocrUnits ? ` and ${coverage.selectedOcr} of ${coverage.ocrUnits} saved OCR passages` : " · No OCR passages"}</p>
    {coverage.selectedUnits < coverage.totalUnits ? <p className="text-muted-foreground">This review used a sample across the source timeline.</p> : null}
    {result.beats.length ? <ol className="list-decimal space-y-2 pl-5">
      {result.beats.map((beat, index) => <li className="break-words" key={index}>
        <details className="space-y-2">
          <summary className="cursor-pointer font-medium">{beat.name}</summary>
          <p className="mt-2">{beat.rationale}</p>
          <ul className="space-y-2">
            {beat.citations.map((citation, i) => {
              const unit = units.get(citation.unitId);
              if (!unit) return null;
              return <li key={i} className="border-l-2 pl-3">
                <p className="font-medium">{evidenceTime(unit.startSeconds, unit.endSeconds)} · {unit.evidenceType === "ocr" ? "On-screen text (OCR)" : "Speech"}</p>
                <blockquote className="whitespace-pre-wrap text-muted-foreground">{citation.quote}</blockquote>
              </li>;
            })}
          </ul>
        </details>
      </li>)}
    </ol> : <p>Studio could not identify a supported writing beat in the supplied evidence.</p>}
    {result.limitations.length ? <div className="space-y-1">
      <h3 className="font-medium">Coverage and interpretation notes</h3>
      <ul className="list-disc space-y-1 break-words pl-5">{result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </div> : null}
  </section>;
}
