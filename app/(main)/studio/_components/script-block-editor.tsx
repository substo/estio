"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Lightbulb, Loader2, Plus, Redo2, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { autosaveScriptAction, regenerateBlockAudioAction, type AutosaveResult } from "../(tenant)/content/actions";
import {
  BLOCK_LABELS, MAX_BLOCKS, blockAudioStatus, blocksDoc, blocksToScript, scriptBlockSpan, insertBlockAfter, makeBlockId, moveBlock, moveBlockTo, narrationBlocks, removeBlock, setBlockAudio, setBlockSpeaker, setBlockText, setBlockType, splitBlock,
  type BlockAudio, type BlockType, type ScriptBlock,
} from "@/lib/studio/script-blocks";
import { ScriptReadingDialog } from "./script-reading-dialog";
import { MAX_SCRIPT_SPEAKER } from "@/lib/studio/script-speakers";
import type { AgentSelection } from "@/lib/studio/agent-policy";
import type { RegenerateResult } from "@/lib/studio/script-audio";
import { providerLabels, type VoiceRow } from "@/lib/studio/voices/policy";

const TYPES = ["narration", "heading", "visual", "break"] as const satisfies readonly BlockType[];
const btn = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50";
const placeholders: Record<BlockType, string> = { narration: "What you say out loud…", heading: "Section title", visual: "What the viewer sees (b-roll, screen, on-screen text)", break: "" };
type Save = "saved" | "unsaved" | "saving" | "error";

/** Notion-style script editor. Blocks autosave through the version-fenced record save; the plain `script` is derived from them on the server. Every drag has a button and keyboard equivalent. */
export function ScriptBlockEditor({ locationId, recordId, version, initialBlocks, voices, initialVoiceId, archived, onVersion, onBlocksChange, onSaveState, onAskAboutBlock, savedScript }: {
  locationId: string; recordId: string; version: number; initialBlocks: ScriptBlock[]; voices: readonly VoiceRow[]; initialVoiceId: string; archived: boolean;
  onVersion: (version: number, savedHere?: boolean) => void; onBlocksChange: (json: string, voiceId: string) => void;
  onSaveState?: (saved: boolean) => void;
  savedScript: string;
  onAskAboutBlock?: (selection: AgentSelection, label: string, origin: HTMLElement) => void;
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState(initialBlocks);
  const [voiceOverride, setVoiceOverride] = useState(initialVoiceId);
  const [save, setSave] = useState<Save>("saved");
  const [saveError, setSaveError] = useState("");
  const [focusError, setFocusError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);     // block id, "all", or null while generating audio
  const [audioMessage, setAudioMessage] = useState("");
  const [slashFor, setSlashFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const past = useRef<ScriptBlock[][]>([]), future = useRef<ScriptBlock[][]>([]), lastPush = useRef({ key: "", at: 0 });
  const blocksRef = useRef(blocks), voiceRef = useRef(voiceOverride);
  const versionRef = useRef(version), lastSaved = useRef(JSON.stringify(blocksDoc(initialBlocks)) + "\n" + initialVoiceId);
  const chain = useRef<Promise<unknown>>(Promise.resolve()), conflict = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fields = useRef(new Map<string, HTMLTextAreaElement | HTMLElement>()), focusNext = useRef<{ id: string; caret?: number } | null>(null);
  const serverScript = useRef(savedScript);
  useEffect(() => {
    if (version <= versionRef.current) return;
    if (savedScript !== serverScript.current) {
      if (`${JSON.stringify(blocksDoc(blocksRef.current))}\n${voiceRef.current}` !== lastSaved.current) {
        conflict.current = true;
        setSave("error");
        setSaveError("This piece changed while you were editing. Your edits are still here; reload the latest piece and review before saving.");
        return;
      }
      serverScript.current = savedScript;
      blocksRef.current = initialBlocks;
      voiceRef.current = initialVoiceId;
      lastSaved.current = `${JSON.stringify(blocksDoc(initialBlocks))}\n${initialVoiceId}`;
      past.current = []; future.current = [];
      setBlocks(initialBlocks); setVoiceOverride(initialVoiceId); setSave("saved"); setSaveError("");
    }
    versionRef.current = version;
    onVersion(version, false);
  }, [initialBlocks, initialVoiceId, onVersion, savedScript, version]);

  const effectiveVoice = voices.find(v => v.id === voiceOverride) ?? voices.find(v => v.isDefault) ?? voices[0] ?? null;
  const hosted = Boolean(effectiveVoice && effectiveVoice.provider !== "local");
  const json = JSON.stringify(blocksDoc(blocks));
  useEffect(() => { blocksRef.current = blocks; voiceRef.current = voiceOverride; onBlocksChange(json, voiceOverride); }, [blocks, voiceOverride, json, onBlocksChange]);

  useEffect(() => { onSaveState?.(save === "saved" && `${json}\n${voiceOverride}` === lastSaved.current); }, [save, json, voiceOverride, onSaveState]);

  // ---- saving: one request at a time, always with the newest version. A stale version is refused by the database and never overwritten. ----
  const persisted = useRef(false); // legacy scripts get fresh block ids on every server read until the blocks are saved once
  const persist = useCallback((force = false): Promise<boolean> => {
    chain.current = chain.current.then(async () => {
      if (conflict.current) return false;
      const currentBlocks = blocksRef.current;
      const payload = JSON.stringify(blocksDoc(currentBlocks)), voice = voiceRef.current, key = `${payload}\n${voice}`;
      if (key === lastSaved.current && !(force && !persisted.current)) { setSave(s => s === "error" ? s : "saved"); return true; }
      setSave("saving");
      const result: AutosaveResult = await autosaveScriptAction(locationId, recordId, versionRef.current, payload, voice).catch(() => ({ ok: false as const, error: "Could not reach Studio. Your edits are still here; retrying." }));
      if (result.ok) {
        versionRef.current = result.version; serverScript.current = blocksToScript(currentBlocks); lastSaved.current = key; persisted.current = true; onVersion(result.version);
        const stillDirty = `${JSON.stringify(blocksDoc(blocksRef.current))}\n${voiceRef.current}` !== key;
        setSave(stillDirty ? "unsaved" : "saved"); setSaveError(""); return true;
      }
      if (result.conflict) conflict.current = true;
      setSave("error"); setSaveError(result.error); return false;
    });
    return chain.current as Promise<boolean>;
  }, [locationId, recordId, onVersion]);

  useEffect(() => {
    if (archived || conflict.current) return;
    if (`${json}\n${voiceOverride}` === lastSaved.current) return;
    setSave(s => s === "saving" ? s : "unsaved");
    timer.current = setTimeout(() => { void persist(); }, 1200);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [json, voiceOverride, archived, persist]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (`${JSON.stringify(blocksDoc(blocksRef.current))}\n${voiceRef.current}` !== lastSaved.current) e.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, []);
  // A save that failed (offline, a blip) tries again on its own; a conflict never does.
  useEffect(() => { if (save !== "error" || conflict.current) return; const t = setTimeout(() => { void persist(); }, 6000); return () => clearTimeout(t); }, [save, persist]);

  // ---- editing: every change goes through commit() so undo sees it ----
  const commit = (next: ScriptBlock[], coalesce?: string) => {
    const now = Date.now();
    if (!(coalesce && lastPush.current.key === coalesce && now - lastPush.current.at < 1200)) { past.current = [...past.current.slice(-99), blocksRef.current]; }
    lastPush.current = { key: coalesce ?? "", at: now }; future.current = [];
    blocksRef.current = next; setBlocks(next);
  };
  const undo = () => { const prev = past.current.pop(); if (!prev) return; future.current.push(blocksRef.current); lastPush.current = { key: "", at: 0 }; blocksRef.current = prev; setBlocks(prev); };
  const redo = () => { const next = future.current.pop(); if (!next) return; past.current.push(blocksRef.current); blocksRef.current = next; setBlocks(next); };
  useEffect(() => { const f = focusNext.current; if (!f) return; focusNext.current = null; const el = fields.current.get(f.id); if (el) { el.focus(); if (f.caret !== undefined && el instanceof HTMLTextAreaElement) el.setSelectionRange(f.caret, f.caret); } });

  const addAfter = (afterId: string | null, type: BlockType) => { const id = makeBlockId(); focusNext.current = { id }; commit(insertBlockAfter(blocksRef.current, afterId, type, id)); };
  const move = (id: string, delta: -1 | 1) => { focusNext.current = { id }; commit(moveBlock(blocksRef.current, id, delta)); };
  const changeType = (id: string, type: BlockType) => { focusNext.current = { id }; setSlashFor(null); commit(setBlockType(blocksRef.current, id, type)); };

  const onKey = (event: React.KeyboardEvent<HTMLTextAreaElement>, block: ScriptBlock, index: number) => {
    const el = event.currentTarget;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); move(block.id, event.key === "ArrowUp" ? -1 : 1); return; }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (slashFor === block.id) { const first = slashOptions(block.text)[0]; if (first) { commit(setBlockText(setBlockType(blocksRef.current, block.id, first), block.id, ""), "slash"); setSlashFor(null); focusNext.current = { id: block.id }; } return; }
      const id = makeBlockId(); focusNext.current = { id, caret: 0 };
      commit(splitBlock(blocksRef.current, block.id, el.selectionStart ?? block.text.length, id)); return;
    }
    if (event.key === "Backspace" && block.text === "" && index > 0) { event.preventDefault(); const prev = blocksRef.current[index - 1]; focusNext.current = { id: prev.id, caret: prev.text.length }; commit(removeBlock(blocksRef.current, block.id)); return; }
    if (event.key === "Escape") setSlashFor(null);
  };
  const slashOptions = (text: string) => TYPES.filter(t => BLOCK_LABELS[t].toLowerCase().startsWith(text.slice(1).toLowerCase()) || t.startsWith(text.slice(1).toLowerCase()));
  const onText = (block: ScriptBlock, text: string) => { setSlashFor(/^\/[a-z ]*$/i.test(text) ? block.id : null); commit(setBlockText(blocksRef.current, block.id, text), `text:${block.id}`); };

  // ---- audio ----
  const regenerate = async (only: string[] | null, label: string) => {
    if (!hosted || busy) return;
    setBusy(label); setAudioMessage("");
    if (timer.current) clearTimeout(timer.current);
    const ok = await persist(true);
    if (!ok) { setBusy(null); setAudioMessage("Save the script first: it could not be saved yet."); return; }
    const snapshot = blocksRef.current;
    const result: RegenerateResult = await regenerateBlockAudioAction(locationId, recordId, versionRef.current, only).catch(() => ({ ok: false as const, error: "Could not reach Studio. Try again." }));
    const audio: Record<string, BlockAudio> = result.audio ?? {};
    if (Object.keys(audio).length || result.ok) {
      const apply = (list: ScriptBlock[]) => Object.entries(audio).reduce((acc, [id, a]) => setBlockAudio(acc, id, a), list);
      const merged = apply(snapshot);
      if (result.version) { versionRef.current = result.version; onVersion(result.version); }
      lastSaved.current = `${JSON.stringify(blocksDoc(merged))}\n${voiceRef.current}`;
      blocksRef.current = apply(blocksRef.current); setBlocks(blocksRef.current);
    }
    setAudioMessage(result.ok ? (result.rendered ? `Audio ready for ${result.rendered} block${result.rendered === 1 ? "" : "s"}.` : "Everything is already up to date.") : result.error);
    setBusy(null);
  };
  const stale = narrationBlocks(blocks).filter(b => blockAudioStatus(b, effectiveVoice?.id ?? null) !== "fresh");

  const brainstorm = async (block: ScriptBlock, index: number, origin: HTMLElement) => {
    setFocusError("");
    if (!onAskAboutBlock) {
      if (!await persist()) return;
      const prompt = `Brainstorm this ${BLOCK_LABELS[block.type].toLowerCase()} from my script. Give me three different ways to do it, keeping the rest of the script as it is.\n\n"${block.text.slice(0, 1200)}"`;
      try { sessionStorage.setItem(`studio-agent-prefill:${recordId}`, prompt); } catch { /* the agent still opens */ }
      router.push(`/studio/content/create?draft=${recordId}`);
      return;
    }
    const before = blocksRef.current;
    const span = scriptBlockSpan(before, block.id);
    if (!span) { setFocusError("Split this block into smaller blocks before asking for a focused edit."); return; }
    if (!await persist(blocksToScript(before) !== serverScript.current)) return;
    if (before !== blocksRef.current) { setFocusError("The blocks changed while saving. Choose the block again."); return; }
    onAskAboutBlock({ stage: "Script", action: "rewrite", ...span }, `${BLOCK_LABELS[block.type]} ${index + 1}`, origin);
  };

  const statusLabel = save === "saving" ? "Saving…" : save === "unsaved" ? "Unsaved changes" : save === "error" ? "Not saved" : "All changes saved";
  return (
    <section aria-label="Script editor" className="space-y-4" onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && event.currentTarget.contains(event.target as Node) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); } }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {voices.length ? <label className="block text-sm font-medium">Voice for this piece
            <select value={voiceOverride} onChange={event => setVoiceOverride(event.target.value)} disabled={archived} className="mt-1 block min-h-11 w-full min-w-56 rounded-md border bg-background px-3 text-sm">
              <option value="">Location default{voices.find(v => v.isDefault) ? ` (${voices.find(v => v.isDefault)!.name})` : voices[0] ? ` (${voices[0].name})` : ""}</option>
              {voices.map(v => <option key={v.id} value={v.id}>{v.name} · {providerLabels[v.provider]}</option>)}
            </select></label>
            : <p className="text-sm text-muted-foreground">No voices yet. <Link className="text-primary hover:underline" href="/settings/voices?from=studio">Set up voices</Link> to hear your narration.</p>}
          {effectiveVoice && !hosted ? <p className="text-xs text-muted-foreground">This voice runs on this Mac. Its audio is made when you make the video.</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScriptReadingDialog blocks={blocks} />
          <span role="status" aria-live="polite" className={`text-xs ${save === "error" ? "text-destructive" : "text-muted-foreground"}`}>{statusLabel}</span>
          <button type="button" className={btn} onClick={undo} aria-label="Undo" disabled={!past.current.length}><Undo2 aria-hidden className="size-4" /></button>
          <button type="button" className={btn} onClick={redo} aria-label="Redo" disabled={!future.current.length}><Redo2 aria-hidden className="size-4" /></button>
        </div>
      </div>
      {save === "error" || focusError ? <p role="alert" className="text-sm text-destructive">{saveError || focusError}</p> : null}

      <ol className="space-y-2" aria-label="Script blocks">
        {blocks.map((block, index) => {
          const status = blockAudioStatus(block, effectiveVoice?.id ?? null);
          const isBreak = block.type === "break";
          // The nth spoken block is the nth line of the transcript, so the transcript can jump here.
          const spoken = narrationBlocks(blocks).findIndex(b => b.id === block.id);
          return (
            <li key={block.id} data-narration={spoken >= 0 ? spoken : undefined} onDragOver={event => { if (dragId) { event.preventDefault(); setOverId(block.id); } }} onDragLeave={() => setOverId(o => o === block.id ? null : o)}
              onDrop={event => { event.preventDefault(); if (dragId && dragId !== block.id) commit(moveBlockTo(blocksRef.current, dragId, index)); setDragId(null); setOverId(null); }}
              className={`rounded-lg border bg-background p-3 ${overId === block.id && dragId !== block.id ? "border-primary ring-1 ring-primary" : ""} ${dragId === block.id ? "opacity-50" : ""}`}>
              {block.type === "narration" ? <details className="px-2 text-xs text-muted-foreground">
                <summary className="min-h-8 cursor-pointer py-2">{block.speaker ? `Speaker · ${block.speaker}` : "Add speaker label"}</summary>
                <label className="flex flex-wrap items-center gap-2">
                  Speaker for block {index + 1}
                  <input type="text" value={block.speaker ?? ""} maxLength={MAX_SCRIPT_SPEAKER} disabled={archived}
                    onChange={event => commit(setBlockSpeaker(blocksRef.current, block.id, event.target.value), `speaker:${block.id}`)}
                    placeholder="Host or guest name" className="min-h-10 min-w-0 rounded-md border bg-background px-2 text-foreground" />
                </label>
                <p className="mt-1">Shown as a credit. The voice reads only the narration.</p>
              </details> : null}
              {isBreak ? <div ref={el => { if (el) fields.current.set(block.id, el); else fields.current.delete(block.id); }} tabIndex={0} role="separator" aria-label="Section break" className="flex items-center gap-3 py-2 text-xs uppercase tracking-wide text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><span className="h-px flex-1 bg-border" />Section break<span className="h-px flex-1 bg-border" /></div>
                : <textarea ref={el => { if (el) { fields.current.set(block.id, el); el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } else fields.current.delete(block.id); }}
                  aria-label={`${BLOCK_LABELS[block.type]} ${index + 1}`} value={block.text} rows={1} maxLength={4500} disabled={archived} placeholder={placeholders[block.type]}
                  onChange={event => onText(block, event.target.value)} onKeyDown={event => onKey(event, block, index)}
                  className={`block w-full resize-none rounded-md border-0 bg-transparent p-2 text-sm leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${block.type === "heading" ? "text-lg font-semibold" : block.type === "visual" ? "italic text-muted-foreground" : ""}`} />}
              {slashFor === block.id ? <div role="listbox" aria-label="Change block type" className="mt-1 flex flex-wrap gap-2">
                {slashOptions(block.text).map(type => <button key={type} type="button" role="option" aria-selected="false" className={btn} onClick={() => { commit(setBlockText(setBlockType(blocksRef.current, block.id, type), block.id, ""), "slash"); setSlashFor(null); focusNext.current = { id: block.id }; }}>{BLOCK_LABELS[type]}</button>)}
              </div> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" draggable={!archived} onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", block.id); setDragId(block.id); }} onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className={`${btn} cursor-grab`} aria-label={`Drag to reorder ${BLOCK_LABELS[block.type]} ${index + 1}. Or use Move up and Move down, or Alt plus arrow keys.`}><GripVertical aria-hidden className="size-4" /></button>
                <button type="button" className={btn} onClick={() => move(block.id, -1)} disabled={archived || index === 0} aria-label={`Move ${BLOCK_LABELS[block.type]} ${index + 1} up`}><ArrowUp aria-hidden className="size-4" /></button>
                <button type="button" className={btn} onClick={() => move(block.id, 1)} disabled={archived || index === blocks.length - 1} aria-label={`Move ${BLOCK_LABELS[block.type]} ${index + 1} down`}><ArrowDown aria-hidden className="size-4" /></button>
                <select value={block.type} onChange={event => changeType(block.id, event.target.value as BlockType)} disabled={archived} aria-label={`Type of block ${index + 1}`} className="min-h-11 rounded-md border bg-background px-2 text-xs">
                  {TYPES.map(type => <option key={type} value={type}>{BLOCK_LABELS[type]}</option>)}
                </select>
                {!isBreak ? <button type="button" className={btn} onClick={event => void brainstorm(block, index, event.currentTarget)} disabled={archived || !block.text.trim()}><Lightbulb aria-hidden className="size-4" />{onAskAboutBlock ? "Ask about this block" : "Brainstorm this section"}</button> : null}
                <button type="button" className={btn} onClick={() => { const prev = blocks[index - 1] ?? blocks[index + 1]; if (prev) focusNext.current = { id: prev.id }; commit(removeBlock(blocksRef.current, block.id)); }} disabled={archived} aria-label={`Delete ${BLOCK_LABELS[block.type]} ${index + 1}`}><Trash2 aria-hidden className="size-4" /></button>
              </div>
              {status ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border px-2 py-1 font-medium">{!hosted ? "Audio is made on this Mac" : status === "fresh" ? "Audio is up to date" : status === "stale" ? "Changed since audio" : "No audio yet"}</span>
                {hosted ? <button type="button" className={btn} disabled={archived || busy !== null} onClick={() => void regenerate([block.id], block.id)}>
                  {busy === block.id ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}{status === "none" ? "Generate audio" : "Regenerate audio"}</button> : null}
                {block.audio && hosted ? <audio controls preload="none" src={`/studio/uploads/${block.audio.uploadId}`} aria-label={status === "stale" ? "Play previous audio" : "Play audio"} className="h-11 max-w-full" /> : null}
              </div> : null}
            </li>
          );
        })}
      </ol>
      {!blocks.length ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Your script is empty. Add your first block below.</p> : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add block">
        <span className="inline-flex min-h-11 items-center gap-1 text-sm font-medium"><Plus aria-hidden className="size-4" />Add block</span>
        {TYPES.map(type => <button key={type} type="button" className={btn} disabled={archived || blocks.length >= MAX_BLOCKS} onClick={() => addAfter(blocks.at(-1)?.id ?? null, type)}>{BLOCK_LABELS[type]}</button>)}
      </div>
      <p className="text-xs text-muted-foreground">Enter splits a block, Backspace on an empty block removes it, type / to change a block's type, Alt+↑/↓ moves it, Ctrl/⌘+Z undoes.</p>

      {hosted ? <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <button type="button" className={btn} disabled={archived || busy !== null || !stale.length} onClick={() => void regenerate(null, "all")}>
          {busy === "all" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <RefreshCw aria-hidden className="size-4" />}Regenerate changed ({stale.length})</button>
        <span className="text-muted-foreground">Hosted voices are billed to your own provider account. Only blocks that changed are voiced again; selecting part of a block to voice again is not available yet.</span>
      </div> : null}
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{audioMessage}</p>
    </section>
  );
}
