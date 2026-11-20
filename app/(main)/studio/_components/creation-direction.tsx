"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { DIRECTION_CHOICES, proposeDirection, type ConfirmedDirection, type CreationSource, type Direction, type DirectionChoice } from "@/lib/studio/creation-policy";

export function CreationDirection({ initialBrief = "", initial, publisher, source, busy, onConfirm, sourceFirst = false, submitLabel = "Confirm direction", children }: {
  initialBrief?: string; initial?: ConfirmedDirection; publisher: string; source: CreationSource | null;
  sourceFirst?: boolean; submitLabel?: string; children?: React.ReactNode;
  busy: boolean; onConfirm: (brief: string, direction: Direction & { choice: DirectionChoice }) => void;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [choice, setChoice] = useState<DirectionChoice | null>(initial?.choice ?? null);
  const [direction, setDirection] = useState<Direction>(initial ?? { publisher: "", viewer: "", goal: "", angle: "" });
  const [details, setDetails] = useState(Boolean(initial));
  const [question, setQuestion] = useState(Boolean(initial) || sourceFirst);
  const choices = source || !brief.trim() ? DIRECTION_CHOICES : DIRECTION_CHOICES.slice(0, 2);
  function pick(next: DirectionChoice) {
    setChoice(next);
    const proposed = proposeDirection(brief, publisher, source, next);
    if (sourceFirst && (next === "promote" || next === "educate")) {
      setDirection({
        publisher,
        viewer: next === "promote" ? `People who could benefit from ${publisher}` : "People interested in the source topic",
        goal: next === "promote" ? `Find an original way to connect a useful idea from the source to ${publisher}.` : "Teach a useful idea from this source through an original example.",
        angle: "",
      });
    } else setDirection(proposed);
    setDetails(next === "custom" || next === "customer");
  }
  function edit(key: keyof Direction, value: string) { setDirection(prev => ({ ...prev, [key]: value })); }
  const invalid = !choice || (choice === "brief" ? !brief.trim() : !direction.publisher.trim() || !direction.viewer.trim() || !direction.goal.trim());
  return <form className="space-y-5" onSubmit={event => {
    event.preventDefault();
    if (!question) return setQuestion(true);
    if (choice && !invalid) onConfirm(brief, { ...direction, choice });
  }}>
    {!sourceFirst && <label className="block space-y-2 text-sm font-medium">
      <span>What do you want to make?</span>
      <Textarea className="min-h-28 text-base" value={brief} maxLength={4000} onChange={event => {
        setBrief(event.target.value);
        setChoice(null);
        setQuestion(false);
      }} placeholder="Paste a brief or describe the video in your own words" />
    </label>}
    {!question && <Button className="min-h-11" disabled={busy}>Review direction</Button>}
    {question && <fieldset className="space-y-4">
      <legend className="text-base font-semibold">Who is this video promoting, and who should watch it?</legend>
      <div className={sourceFirst ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
        {brief.trim() && <Choice id="brief" selected={choice} onPick={pick} label="Use my brief as written" description="Keep the objective, audience and details you supplied." />}
        {choices.map(option => <Choice key={option.id} id={option.id} selected={choice} onPick={pick}
          label={option.id === "promote" ? `Promote ${publisher}` : sourceFirst && option.id === "educate" ? "Teach something from the source" : option.label}
          description={sourceFirst && option.id === "promote" ? "Find a source-inspired way to speak to our audience."
            : sourceFirst && option.id === "educate" ? "Draw out a useful idea for people interested in this topic." : option.description} />)}
        <Choice id="custom" selected={choice} onPick={pick} label="Describe a different direction" description="Enter the publisher, viewer and outcome in your own words." />
      </div>
      {choice && <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
        <p className="font-medium">{choice === "brief" ? "Supplied direction" : "Assumptions to confirm"}</p>
        {details ? <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">Publisher<Input value={direction.publisher} onChange={e => edit("publisher", e.target.value)} maxLength={180} /></label>
          <label className="space-y-1">Target viewer<Input value={direction.viewer} onChange={e => edit("viewer", e.target.value)} maxLength={500} /></label>
          {choice !== "brief" && <label className="space-y-1 sm:col-span-2">Goal<Textarea value={direction.goal} onChange={e => edit("goal", e.target.value)} maxLength={800} /></label>}
          <label className="space-y-1 sm:col-span-2">Angle, if you have one<Input value={direction.angle} onChange={e => edit("angle", e.target.value)} maxLength={800} /></label>
        </div> : <dl className={sourceFirst ? "grid gap-2" : "grid gap-2 sm:grid-cols-2"}>
          <div><dt className="font-medium">Publisher</dt><dd>{direction.publisher || "Use the publisher described in your brief"}</dd></div>
          <div><dt className="font-medium">Target viewer</dt><dd>{direction.viewer || "Use the audience described in your brief"}</dd></div>
          <div><dt className="font-medium">Goal</dt><dd>{choice === "brief" ? "Follow the supplied brief" : direction.goal}</dd></div>
          <div><dt className="font-medium">Angle</dt><dd>{direction.angle || "Open for development"}</dd></div>
        </dl>}
        {!details && <Button className="min-h-11" type="button" variant="outline" onClick={() => setDetails(true)}>Edit details</Button>}
      </div>}
      {choice && children}
      <Button className="min-h-11" disabled={busy || invalid}>{busy ? "Submitting…" : submitLabel}</Button>
    </fieldset>}
  </form>;
}

function Choice({ id, selected, onPick, label, description }: {
  id: DirectionChoice; selected: DirectionChoice | null; onPick: (id: DirectionChoice) => void; label: string; description: string;
}) {
  return <label className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
    <input type="radio" name="creation-direction" className="mt-1 accent-primary" checked={selected === id} onChange={() => onPick(id)} />
    <span><span className="block font-medium">{label}</span><span className="block text-muted-foreground">{description}</span></span>
  </label>;
}
