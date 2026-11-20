"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, MicOff } from "lucide-react";

type SpeechResult = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string; onresult: ((event: SpeechResult) => void) | null; onerror: (() => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition;
};
export function CreationFeedback({ value, onChange, label, id }: { value: string; onChange: (value: string) => void; label: string; id: string }) {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const browser = window as SpeechWindow;
    setAvailable(Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition));
    return () => {
      if (recognition.current) {
        recognition.current.onresult = recognition.current.onerror = recognition.current.onend = null;
        recognition.current.abort();
      }
    };
  }, []);
  function dictate() {
    if (active) return recognition.current?.stop();
    const browser = window as SpeechWindow;
    const Speech = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Speech) return;
    const session = new Speech();
    recognition.current = session;
    session.lang = navigator.language;
    session.onresult = event => {
      const transcript = Array.from(event.results, result => result[0]?.transcript ?? "").join(" ").trim();
      const existing = field.current?.value ?? "";
      if (transcript) onChange([existing, transcript].filter(Boolean).join(" ").slice(0, 1200));
      setStatus(transcript ? "Dictation added to feedback." : "No speech detected.");
    };
    session.onerror = () => setStatus("Dictation unavailable. Type your feedback here.");
    session.onend = () => { setActive(false); setStatus(previous => previous === "Listening…" ? "Dictation ended." : previous); };
    try { session.start(); setActive(true); setStatus("Listening…"); }
    catch { setStatus("Dictation unavailable. Type your feedback here."); }
  }
  return <div className="space-y-2">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    <Textarea id={id} ref={field} className="min-h-20 text-base" value={value} onChange={e => onChange(e.target.value)} maxLength={1200} />
    {available ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={dictate} aria-describedby={`${id}-speech`}>
        {active ? <MicOff aria-hidden="true" className="size-4" /> : <Mic aria-hidden="true" className="size-4" />}{active ? "Stop dictation" : "Dictate"}
      </Button>
      <span id={`${id}-speech`} className="text-xs text-muted-foreground">Uses your browser’s speech service.</span>
    </div> : <p className="text-xs text-muted-foreground">You can also dictate with your device keyboard.</p>}
    <span className="text-sm text-muted-foreground" role="status">{status}</span>
  </div>;
}
