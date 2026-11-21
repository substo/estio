"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = { start(): void; stop(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: any) => void) | null; onerror: ((event: any) => void) | null; onend: (() => void) | null };
/** Browser speech-to-text appended to a typed field. Typing always remains available. */
export function useDictation(append: (heard: string) => void) {
  const engine = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState("");
  const [supported, setSupported] = useState(false);
  useEffect(() => { setSupported(Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); return () => engine.current?.stop(); }, []);
  const stop = useCallback(() => engine.current?.stop(), []);
  const toggle = useCallback(() => {
    if (engine.current) { engine.current.stop(); return; }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    const next: Recognition = new Ctor();
    next.continuous = true; next.interimResults = false; next.lang = navigator.language || "en-US";
    next.onresult = event => { let heard = ""; for (let i = event.resultIndex; i < event.results.length; i++) if (event.results[i].isFinal) heard += event.results[i][0].transcript; if (heard.trim()) append(heard.trim()); };
    next.onerror = event => setNote(event.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : "Dictation stopped. You can keep typing.");
    next.onend = () => { setListening(false); engine.current = null; };
    setNote(""); engine.current = next; setListening(true);
    try { next.start(); } catch { setListening(false); engine.current = null; setNote("Dictation could not start. You can type instead."); }
  }, [append]);
  return { supported, listening, note, toggle, stop };
}
