"use client";
import { useActionState, useRef, useState } from "react";
import { AVATAR_NOTE } from "@/lib/studio/avatar-note";
import { removeAvatarAction, saveAvatarAction } from "./actions";

type State = { error?: string; notice?: string };
/** One private photo per person: the stand-in picture on storyboard placeholders. Everything here is about the signed-in user only. */
export function YourLookCard({ locationId, photoUrl }: { locationId: string; photoUrl: string | null }) {
  const [saveState, save, saving] = useActionState<State, FormData>((prev, form) => saveAvatarAction(locationId, prev, form), {});
  const [removeState, remove, removing] = useActionState<State, FormData>(prev => removeAvatarAction(locationId, prev), {});
  const [chosen, setChosen] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const message = saveState.error ?? removeState.error ?? saveState.notice ?? removeState.notice;
  const isError = Boolean(saveState.error ?? removeState.error);
  return (
    <section aria-labelledby="your-look-heading" className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 id="your-look-heading" className="text-base font-semibold">Your look</h2>
        <p className="text-sm text-muted-foreground">A photo of you to use as the stand-in picture while a video is made, so a storyboard shows you instead of a grey card. {AVATAR_NOTE}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {photoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photoUrl} alt="Your saved photo" className="size-20 rounded-md border object-cover" /> : <div aria-hidden="true" className="flex size-20 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">No photo</div>}
        <form action={save} className="space-y-2">
          <label className="block text-sm font-medium">{photoUrl ? "Replace photo" : "Choose a photo"}
            <input ref={input} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={saving} onChange={event => setChosen(event.target.files?.[0]?.name ?? "")} className="mt-1 block w-full text-sm" /></label>
          <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 5 MB. A clear, front-facing photo works best.</p>
          <button type="submit" disabled={saving || !chosen} className="inline-flex min-h-11 items-center rounded-md border bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{saving ? "Saving…" : "Save photo"}</button>
        </form>
        {photoUrl ? <form action={remove}><button type="submit" disabled={removing} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{removing ? "Removing…" : "Remove photo"}</button></form> : null}
      </div>
      {message ? <p role={isError ? "alert" : "status"} className={`text-sm ${isError ? "text-destructive" : "text-muted-foreground"}`}>{message}</p> : null}
    </section>
  );
}
