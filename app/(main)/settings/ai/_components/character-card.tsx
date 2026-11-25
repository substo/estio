"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { AVATAR_NOTE } from "@/lib/studio/avatar-note";
import { ASPECT_KEYS, MAX_CHARACTER_PHOTOS, PHOTO_ROLES, PHOTO_ROLE_LABELS, PHOTO_TIPS, SHEET_LABELS, characterCard, type CharacterAspect, type CharacterProfile, type PhotoRole } from "@/lib/studio/images/character-sheet";
import { getCharacterSheetsAction, removeCharacterPhotoAction, requestCharacterSheetAction, saveCharacterPhotoAction, saveCharacterProfileAction } from "../actions";
import type { SheetView } from "@/lib/studio/character-sheets";

interface Photo { n: number; role: PhotoRole; url: string }
const DEFAULT_ROLE: PhotoRole[] = ["face-front", "face-angle", "full-body", "outfit", "other"];
const FREE_BY_DEFAULT = ["clothing", "accessories", "glasses"];

function Slot({ locationId, n, photo, onChange }: { locationId: string; n: number; photo: Photo | undefined; onChange: (photo: Photo | null) => void }) {
  const [role, setRole] = useState<PhotoRole>(photo?.role ?? DEFAULT_ROLE[n - 1]);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const upload = (file: File | undefined) => {
    if (!file) return;
    const form = new FormData(); form.set("photo", file); setMessage("");
    start(async () => { const r = await saveCharacterPhotoAction(locationId, n, role, form); if (r.error) setMessage(r.error); else onChange({ n, role, url: URL.createObjectURL(file) }); if (input.current) input.current.value = ""; });
  };
  const remove = () => start(async () => { const r = await removeCharacterPhotoAction(locationId, n); if (r.error) setMessage(r.error); else onChange(null); });
  return <li className="space-y-2 rounded-md border p-3">
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">Photo {n}</p>{photo ? <button type="button" onClick={remove} disabled={pending} className="min-h-9 text-xs text-destructive hover:underline disabled:opacity-60">Remove</button> : null}</div>
    {photo ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photo.url} alt={`Photo ${n}: ${PHOTO_ROLE_LABELS[photo.role]}`} className="aspect-square w-full rounded-md border object-cover" />
      : <div aria-hidden="true" className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">No photo</div>}
    <label className="block text-xs"><span className="sr-only">What photo {n} shows</span>
      <select value={photo?.role ?? role} disabled={pending || Boolean(photo)} onChange={e => setRole(e.target.value as PhotoRole)} className="min-h-9 w-full rounded-md border bg-background px-2 text-xs">{PHOTO_ROLES.map(r => <option key={r} value={r}>{PHOTO_ROLE_LABELS[r]}</option>)}</select></label>
    <label className="block"><span className="sr-only">{photo ? "Replace" : "Choose"} photo {n}</span>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={e => upload(e.target.files?.[0])} className="block w-full text-xs file:mr-2 file:min-h-9 file:rounded-md file:border file:bg-background file:px-2 file:text-xs" /></label>
    {pending ? <p className="text-xs text-muted-foreground" aria-live="polite">Working…</p> : null}
    {message ? <p role="alert" className="text-xs text-destructive">{message}</p> : null}
  </li>;
}

/** Settings → AI → Character: up to five of your own photos and the character card that every storyboard frame is drawn from. Locked aspects stay the same in every picture; free ones (usually clothing) change per scene. */
export function CharacterCard({ locationId, photos: initial, profile: initialProfile, sheets: initialSheets }: { locationId: string; photos: Photo[]; profile: CharacterProfile; sheets: SheetView[] }) {
  const [photos, setPhotos] = useState<Photo[]>(initial);
  const [aspects, setAspects] = useState<CharacterAspect[]>(initialProfile.aspects);
  const [notes, setNotes] = useState(initialProfile.notes ?? "");
  const [saved, setSaved] = useState<string>("");
  const [pending, start] = useTransition();
  const setPhoto = (n: number, photo: Photo | null) => setPhotos(list => [...list.filter(p => p.n !== n), ...(photo ? [photo] : [])].sort((a, b) => a.n - b.n));
  const unused = ASPECT_KEYS.filter(k => !aspects.some(a => a.key === k));
  const card = characterCard({ aspects, notes });
  const save = () => start(async () => { setSaved(""); const r = await saveCharacterProfileAction(locationId, aspects, notes); setSaved(r.error ?? "Saved."); });
  return <section aria-labelledby="char-heading" className="space-y-5">
    <div className="space-y-1 rounded-lg border p-4">
      <h2 id="char-heading" className="text-base font-semibold">Your character</h2>
      <p className="text-sm text-muted-foreground">Up to {MAX_CHARACTER_PHOTOS} photos of you. Storyboard frames show you in new scenes, drawn from these photos and the card below, so the same person appears in every frame. {AVATAR_NOTE}</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{PHOTO_TIPS.map(t => <li key={t}>{t}</li>)}</ul>
    </div>
    <div className="space-y-2"><h3 className="text-sm font-semibold">Photos</h3>
      <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: MAX_CHARACTER_PHOTOS }, (_, i) => i + 1).map(n => <Slot key={`${n}-${photos.find(p => p.n === n)?.url ?? "x"}`} locationId={locationId} n={n} photo={photos.find(p => p.n === n)} onChange={photo => setPhoto(n, photo)} />)}</ul>
    </div>
    <div className="space-y-3 rounded-lg border p-4">
      <div><h3 className="text-sm font-semibold">Character card</h3><p className="text-xs text-muted-foreground">What stays true about you. <strong>Locked</strong> aspects are repeated in every picture; <strong>free</strong> ones (clothing, glasses) can change from scene to scene.</p></div>
      <ul className="space-y-2">{aspects.map((a, i) => <li key={a.key} className="flex flex-wrap items-center gap-2">
        <span className="w-28 shrink-0 text-sm font-medium capitalize">{a.key}</span>
        <input aria-label={`${a.key}`} value={a.value} maxLength={200} onChange={e => setAspects(list => list.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} className="min-h-9 min-w-48 flex-1 rounded-md border bg-background px-2 text-sm" />
        <button type="button" aria-pressed={a.locked} onClick={() => setAspects(list => list.map((x, j) => j === i ? { ...x, locked: !x.locked } : x))} className={`min-h-9 rounded-full border px-3 text-xs ${a.locked ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}>{a.locked ? "Locked" : "Free"}</button>
        <button type="button" onClick={() => setAspects(list => list.filter((_, j) => j !== i))} className="min-h-9 px-1 text-xs text-destructive hover:underline">Remove</button></li>)}</ul>
      {unused.length ? <label className="block text-sm"><span className="sr-only">Add an aspect</span>
        <select value="" onChange={e => { const key = e.target.value as CharacterAspect["key"]; if (key) setAspects(list => [...list, { key, value: "", locked: !FREE_BY_DEFAULT.includes(key) }]); }} className="min-h-9 rounded-md border bg-background px-2 text-sm"><option value="">Add an aspect…</option>{unused.map(k => <option key={k} value={k} className="capitalize">{k}</option>)}</select></label> : null}
      <label className="block text-sm font-medium">Anything else that must stay true<textarea value={notes} maxLength={400} rows={2} onChange={e => setNotes(e.target.value)} placeholder="e.g. slim build, broad shoulders, always clean-shaven" className="mt-1 block w-full rounded-md border bg-background p-2 text-sm font-normal" /></label>
      <p className="rounded-md bg-muted/40 p-2 text-xs"><span className="font-medium">How this is written into every picture: </span>{card}</p>
      <div className="flex flex-wrap items-center gap-3"><Button type="button" size="sm" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save character card"}</Button>{saved ? <span role="status" className="text-sm text-muted-foreground">{saved}</span> : null}</div>
    </div>
    <Sheets locationId={locationId} initial={initialSheets} hasPhotos={photos.length > 0} />
  </section>;
}

const SHEET_KINDS = ["turnaround", "expressions", "face"] as const;
const statusLine = (s: SheetView | undefined) => !s ? "Not drawn yet" : s.status === "queued" ? "Waiting for your Mac…" : s.status === "running" ? "Your Mac is drawing it (about a minute)…" : s.status === "succeeded" ? "Ready" : s.status === "cancelled" ? "Cancelled. Try again once your Mac is ready." : (s.error ?? "The Mac could not draw this. Try again.");

/** The reference sheets drawn from your photos and card by Codex on your Mac (your ChatGPT subscription). They are the pictures every storyboard frame is drawn from. */
function Sheets({ locationId, initial, hasPhotos }: { locationId: string; initial: SheetView[]; hasPhotos: boolean }) {
  const [sheets, setSheets] = useState<SheetView[]>(initial);
  const [message, setMessage] = useState<{ error?: string; notice?: string }>({});
  const [pending, start] = useTransition();
  const busy = sheets.some(s => s.status === "queued" || s.status === "running");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { void getCharacterSheetsAction(locationId).then(setSheets); }, 6000);
    return () => window.clearInterval(timer);
  }, [busy, locationId]);
  const ask = (kinds: readonly string[]) => start(async () => {
    setMessage({});
    for (const kind of kinds) { const r = await requestCharacterSheetAction(locationId, kind); if (r.error) { setMessage(r); break; } setMessage(r); }
    setSheets(await getCharacterSheetsAction(locationId));
  });
  return <div className="space-y-3 rounded-lg border p-4">
    <div><h3 className="text-sm font-semibold">Character sheets</h3>
      <p className="text-xs text-muted-foreground">Your Mac draws reference sheets from your photos and card with Codex, on your ChatGPT subscription: no extra cost, and the Mac must be on. Every storyboard frame is then drawn from these. Each one takes about a minute and uses roughly 20,000 tokens of your Codex allowance.</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={pending || busy || !hasPhotos} onClick={() => ask(SHEET_KINDS)}>{busy ? "Drawing…" : "Generate everything"}</Button>
      {!hasPhotos ? <span className="text-xs text-muted-foreground">Add at least one photo first.</span> : null}
      {message.error ? <span role="alert" className="text-sm text-destructive">{message.error}</span> : message.notice ? <span role="status" className="text-sm text-muted-foreground">{message.notice}</span> : null}
    </div>
    <ul className="grid gap-3 lg:grid-cols-3">{SHEET_KINDS.map(kind => { const s = sheets.find(x => x.sheet === kind), file = s?.status === "succeeded" ? s.files[0] : undefined;
      return <li key={kind} className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{SHEET_LABELS[kind]}</p>
          <Button type="button" size="sm" variant="outline" disabled={pending || busy || !hasPhotos} onClick={() => ask([kind])}>{s?.status === "succeeded" ? "Redo" : "Draw"}</Button></div>
        {file ? /* eslint-disable-next-line @next/next/no-img-element */ <a href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt={`${SHEET_LABELS[kind]} sheet`} className="w-full rounded-md border" /></a>
          : <div aria-hidden="true" className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">{s?.status === "running" || s?.status === "queued" ? "…" : "No sheet yet"}</div>}
        <p className={`text-xs ${s?.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">{statusLine(s)}</p>
      </li>; })}</ul>
  </div>;
}
