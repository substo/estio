"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Circle, ExternalLink, Loader2, Lock, Minus, Pencil, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { FieldView, OnboardingView, TopicView } from "@/lib/onboarding/view";
import { displayValue, fieldFormat, fromText, multiline, toText } from "@/lib/onboarding/field-text";
import { ONBOARDING_LATER_COOKIE, type ConnectLink } from "@/lib/onboarding/entry";
import { activeTopic, currentTopic } from "@/lib/onboarding/screen-state";

type Props = { initialView: OnboardingView; locationId: string; connect: ConnectLink[]; homeHref: string; updateMode?: boolean };
type Editing = { topic: string; field: string } | null;

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/**
 * Business onboarding: a timeline of topics that fills in as research and answers arrive, beside a chat that asks one
 * thing at a time and offers what research found to confirm, edit or skip. Phones and portrait tablets switch between
 * the two with tabs. Without an AI connection the chat is locked and explains what to connect.
 */
export function OnboardingScreen({ initialView, locationId, connect, homeHref, updateMode }: Props) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [editing, setEditing] = useState<Editing>(null), [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "profile">("chat");
  const chatInput = useRef<HTMLTextAreaElement>(null), chatEnd = useRef<HTMLDivElement>(null);
  const locked = view.openMode === "locked" || (!view.ai.available && view.canEdit);
  const current = useMemo(() => currentTopic(view.topics), [view.topics]);
  const active = activeTopic(view.topics, selected) ?? undefined;
  const started = view.status !== "not_started" || Boolean(view.input.name || view.input.website);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding", { cache: "no-store", headers: { "X-Studio-Tenant": locationId } });
      const data = await res.json(); if (res.ok && data.view) setView(data.view);
    } catch { /* the next poll retries */ }
  }, [locationId]);
  // Poll while research runs; stop when it is idle.
  useEffect(() => { if (!view.researching) return; const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }, [view.researching, load]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [view.messages.length]);

  async function command(body: Record<string, unknown>, after?: () => void) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Try again.");
      setView(data.view); after?.(); return true;
    } catch (e) { setError(e instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : e instanceof Error ? e.message : String(e)); return false; }
    finally { setBusy(false); }
  }
  const later = () => { document.cookie = `${ONBOARDING_LATER_COOKIE}=${encodeURIComponent(locationId)}; path=/; SameSite=Lax`; window.location.assign(homeHref); };
  const edit = (topic: string, field: string) => { setSelected(topic); setEditing({ topic, field }); setTab("profile"); };

  const timeline = <Timeline view={view} active={active} editing={editing} busy={busy} canEdit={view.canEdit}
    onSelect={id => setSelected(id)} onEdit={edit} onCancel={() => setEditing(null)}
    onSave={(topic, field, value) => command(typeof value === "object" && value && "fieldState" in value ? { action: "field-state", topic, field, status: value.fieldState } : { action: "edit", topic, field, value }, () => setEditing(null))}
    onConfirm={(topic, field) => command({ action: "confirm", topic, field })} />;

  const chat = <section aria-label="Onboarding chat" className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card">
    <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
      {view.messages.map(m => <Message key={m.id} role={m.role} text={m.text} />)}
      {locked ? <ConnectCard links={connect} canEdit={view.canEdit} />
        : !view.canEdit ? <p className="rounded-lg border bg-muted/40 p-3 text-sm">Only an admin of this {view.app === "substo" ? "brand" : "location"}, signed in as themselves, can fill in the business profile.</p>
        : !started ? <StartCard busy={busy} defaultName={String(view.topics.find(t => t.id === "business")?.fields.find(f => f.key === "name")?.value ?? "")} onStart={(values) => command({ action: "start", ...values }, () => chatInput.current?.focus())} />
        : current ? <TopicPrompt topic={current} busy={busy}
            onConfirmAll={() => command({ action: "confirm-topic", topic: current.id }, () => chatInput.current?.focus())}
            onEdit={field => edit(current.id, field)} onSkip={() => command({ action: "skip", topic: current.id }, () => chatInput.current?.focus())} />
        : <Summary view={view} busy={busy} onFinish={() => command({ action: "finish" })} onResearch={() => command({ action: "start" })} />}
      {started && !locked && <ResearchProgress topics={view.topics} researching={view.researching} note={view.researchNote} />}
      <div ref={chatEnd} />
    </div>
    <form className="flex items-end gap-2 border-t p-3" onSubmit={async e => {
      e.preventDefault(); const text = chatInput.current?.value.trim(); if (!text) return;
      if (await command({ action: "say", text, ...(current ? { topic: current.id } : {}) })) { chatInput.current!.value = ""; chatInput.current!.focus(); }
    }}>
      <label htmlFor="onboarding-answer" className="sr-only">Your answer</label>
      <Textarea id="onboarding-answer" ref={chatInput} rows={2} maxLength={2000} disabled={locked || !view.canEdit || !started || busy}
        placeholder={locked ? "Connect an AI to start" : !started ? "Start with your business name or website above" : "Answer in your own words…"}
        className="min-h-[2.75rem] flex-1 resize-y"
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <Button type="submit" disabled={locked || !view.canEdit || !started || busy} aria-label="Send answer">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
      </Button>
    </form>
  </section>;

  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-3 p-3 md:p-6 lg:h-[calc(100dvh-4.5rem)]">
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Business profile</h1>
      <Badge variant={view.status === "done" ? "default" : "secondary"}>{view.status === "done" ? "Complete" : !started ? "Not started" : `${view.completeness.confirmed} of ${view.completeness.total} topics done`}</Badge>
      {view.researching && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Researching</span>}
      <div className="ml-auto flex gap-2">
        {view.status !== "done" && !updateMode && <Button variant="ghost" size="sm" onClick={later}>Later</Button>}
        {(view.status === "done" || updateMode) && <Button variant="ghost" size="sm" asChild><Link href={homeHref}>Back</Link></Button>}
      </div>
    </header>
    {error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm">{error}</p>}
    <div role="tablist" aria-label="Onboarding views" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 lg:hidden">
      {(["chat", "profile"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{t === "chat" ? "Chat" : "Profile"}</button>)}
    </div>
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className={`${tab === "profile" ? "" : "hidden"} min-h-0 lg:block lg:overflow-y-auto`}>{timeline}</div>
      <div className={`${tab === "chat" ? "flex" : "hidden"} min-h-[28rem] flex-col lg:flex lg:min-h-0`}>{chat}</div>
    </div>
  </main>;
}

function Message({ role, text }: { role: string; text: string }) {
  if (role === "system") return <p className="text-center text-xs text-muted-foreground">{text}</p>;
  return <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${role === "owner" ? "ml-auto bg-primary text-primary-foreground" : "border bg-background"}`}>{text}</div>;
}

function ConnectCard({ links, canEdit }: { links: ConnectLink[]; canEdit: boolean }) {
  return <div className="space-y-3 rounded-xl border-2 border-dashed p-4">
    <p className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4" aria-hidden />Connect an AI to start</p>
    <p className="text-sm text-muted-foreground">I research your business with your own AI account, so it runs on your plan or key. Connect any one of these{canEdit ? "" : " (an admin needs to do this)"}, then come back:</p>
    <ul className="space-y-2">{links.map(l => <li key={l.href}><Link href={l.href} className="flex items-start gap-2 rounded-lg border bg-background p-3 hover:bg-muted">
      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><span className="block text-sm font-medium">{l.label}</span><span className="block text-xs text-muted-foreground">{l.description}</span></span></Link></li>)}</ul>
  </div>;
}

function StartCard({ busy, defaultName, onStart }: { busy: boolean; defaultName: string; onStart: (values: Record<string, string>) => void }) {
  return <form className="space-y-3 rounded-xl border bg-background p-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onStart(Object.fromEntries(Array.from(f.entries()).map(([k, v]) => [k, String(v).trim()]))); }}>
    <p className="text-sm">Tell me what you are building. Research follows your stage and setup; you confirm every suggestion.</p>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className="text-sm">Stage<select name="stage" autoFocus required className="mt-1 block w-full rounded-md border bg-background p-2"><option value="">Choose stage</option><option value="starting">Starting from scratch</option><option value="operating">Already operating</option></select></label>
      <label className="text-sm">Identity<select name="kind" required className="mt-1 block w-full rounded-md border bg-background p-2"><option value="">Choose identity</option><option value="business">Business</option><option value="personal_brand">Personal brand</option></select></label>
      <label className="text-sm">Presence<select name="presence" required className="mt-1 block w-full rounded-md border bg-background p-2"><option value="">Choose presence</option><option value="online">Online</option><option value="physical">Physical</option><option value="both">Both</option></select></label>
    </div>
    <label className="block space-y-1 text-sm"><span>Describe your business or personal brand</span><Textarea name="summary" required maxLength={2000} rows={3} /></label>
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span className="font-medium">Business name</span><Input name="name" defaultValue={defaultName} maxLength={200} autoComplete="organization" /></label>
      <label className="space-y-1 text-sm"><span className="font-medium">Website</span><Input name="website" maxLength={2048} inputMode="url" placeholder="example.com" autoComplete="url" /></label>
    </div>
    <Button type="submit" disabled={busy}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="mr-2 h-4 w-4" aria-hidden />}Start research</Button>
  </form>;
}

function Sources({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return <span className="text-xs text-muted-foreground"> · from {urls.slice(0, 2).map((u, i) => <a key={u} href={u} target="_blank" rel="noreferrer" className="underline">{i ? ", " : ""}{host(u)}</a>)}</span>;
}

function TopicPrompt({ topic, busy, onConfirmAll, onEdit, onSkip }: { topic: TopicView; busy: boolean; onConfirmAll: () => void; onEdit: (field: string) => void; onSkip: () => void }) {
  const suggested = topic.fields.filter(f => f.status === "suggested");
  return <div className="space-y-3 rounded-xl border bg-background p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{topic.title}</p>
    {suggested.length ? <>
      <p className="text-sm">Is this right?</p>
      <ul className="space-y-1.5">{suggested.map(f => <li key={f.key} className="text-sm"><span className="font-medium">{f.label}:</span> {f.suggestion?.value ?? displayValue(f.kind, f.value)}<Sources urls={f.suggestion?.sources ?? f.sources} /></li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onConfirmAll}><Check className="mr-1 h-4 w-4" aria-hidden />{suggested.length > 1 ? "Confirm all" : "Confirm"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(suggested[0].key)}><Pencil className="mr-1 h-4 w-4" aria-hidden />Edit</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>Skip</Button>
      </div>
    </> : <>
      <p className="text-sm">{topic.researching ? `I'm still looking this up. Meanwhile: ${topic.question}` : topic.question}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(topic.fields[0].key)}><Pencil className="mr-1 h-4 w-4" aria-hidden />Fill in directly</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>Skip</Button></div>
    </>}
  </div>;
}

function ResearchProgress({ topics, researching, note }: { topics: TopicView[]; researching: boolean; note?: string | null }) {
  const running = topics.filter(t => t.researching), failed = topics.filter(t => t.researchError);
  if (!researching && !failed.length) return null;
  return <div className="space-y-1 text-xs text-muted-foreground" role="status">
    {researching && <p className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Researching {running.length ? running.map(t => t.title.toLowerCase()).join(", ") : "your website"}…</p>}
    {researching && note && <p>{note}</p>}
    {failed.map(t => <p key={t.id}>Couldn&apos;t research {t.title.toLowerCase()}: {t.researchError}. You can fill it in yourself.</p>)}
  </div>;
}

function Summary({ view, busy, onFinish, onResearch }: { view: OnboardingView; busy: boolean; onFinish: () => void; onResearch: () => void }) {
  const done = view.topics.filter(t => t.status === "confirmed"), missing = view.topics.filter(t => t.status !== "confirmed");
  return <div className="space-y-3 rounded-xl border bg-background p-4">
    <p className="font-medium">{view.status === "done" ? "Your business profile is saved." : "Here's everything I'll save."}</p>
    <dl className="space-y-2 text-sm">{done.map(t => <div key={t.id}><dt className="font-medium">{t.title}</dt>
      <dd className="text-muted-foreground">{t.fields.filter(f => f.value !== null && toText(f.kind, f.value)).map(f => `${f.label}: ${displayValue(f.kind, f.value, 80)}`).join(" · ") || "Nothing to add"}</dd></div>)}</dl>
    {missing.length > 0 && <p className="text-sm"><span className="font-medium">Still missing:</span> {missing.map(t => t.title).join(", ")}. You can add these any time.</p>}
    <div className="flex flex-wrap gap-2">
      {view.status !== "done" && <Button disabled={busy} onClick={onFinish}><Check className="mr-1 h-4 w-4" aria-hidden />Finish</Button>}
      <Button variant="outline" disabled={busy} onClick={onResearch}><Sparkles className="mr-1 h-4 w-4" aria-hidden />Research again</Button>
    </div>
  </div>;
}

function StatusIcon({ topic }: { topic: TopicView }) {
  const cls = "h-4 w-4";
  if (topic.researching) return <Loader2 className={`${cls} animate-spin text-muted-foreground`} aria-label="Researching" />;
  if (topic.status === "confirmed") return <Check className={`${cls} text-emerald-600`} aria-label="Confirmed" />;
  if (topic.status === "suggested") return <Sparkles className={`${cls} text-amber-500`} aria-label="Suggestions to confirm" />;
  if (topic.status === "skipped") return <Minus className={`${cls} text-muted-foreground`} aria-label="Skipped" />;
  return <Circle className={`${cls} text-muted-foreground`} aria-label="Not started" />;
}

function Timeline({ view, active, editing, busy, canEdit, onSelect, onEdit, onCancel, onSave, onConfirm }: {
  view: OnboardingView; active: string | undefined; editing: Editing; busy: boolean; canEdit: boolean;
  onSelect: (id: string) => void; onEdit: (topic: string, field: string) => void; onCancel: () => void;
  onSave: (topic: string, field: string, value: unknown) => void; onConfirm: (topic: string, field: string) => void }) {
  return <ol aria-label="Profile topics" className="relative space-y-1 rounded-xl border bg-card p-3">
    {view.topics.map((t, i) => {
      const open = t.id === active || t.fields.some(f => f.status !== "empty");
      return <li key={t.id} className="relative pl-7">
        {i < view.topics.length - 1 && <span aria-hidden className="absolute left-[0.6rem] top-6 h-[calc(100%-0.75rem)] w-px bg-border" />}
        <span className="absolute left-0 top-1.5"><StatusIcon topic={t} /></span>
        <button type="button" onClick={() => onSelect(t.id)} aria-current={t.id === active ? "step" : undefined}
          className={`w-full rounded-md px-2 py-1 text-left text-sm font-medium hover:bg-muted ${t.id === active ? "bg-muted" : ""}`}>{t.title}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{t.researching ? "researching" : t.status === "suggested" ? "to confirm" : t.status === "confirmed" ? "done" : t.status === "skipped" ? "skipped" : ""}</span></button>
        {open && <dl className="mb-2 mt-1 space-y-1.5 pl-2">{t.fields.map(f => <FieldRow key={f.key} topic={t.id} field={f} busy={busy} canEdit={canEdit}
          editing={editing?.topic === t.id && editing.field === f.key} onEdit={() => onEdit(t.id, f.key)} onCancel={onCancel}
          onSave={value => onSave(t.id, f.key, value)} onConfirm={() => onConfirm(t.id, f.key)} />)}</dl>}
      </li>;
    })}
  </ol>;
}

function FieldRow({ topic, field, busy, canEdit, editing, onEdit, onCancel, onSave, onConfirm }: { topic: string; field: FieldView; busy: boolean; canEdit: boolean;
  editing: boolean; onEdit: () => void; onCancel: () => void; onSave: (value: unknown) => void; onConfirm: () => void }) {
  const id = `field-${topic}-${field.key}`;
  const shown = field.suggestion?.value ?? displayValue(field.kind, field.value);
  if (editing) return <EditField id={id} field={field} busy={busy} onCancel={onCancel} onSave={onSave} />;
  return <div className="group text-sm">
    <dt className="text-xs text-muted-foreground">{field.label}</dt>
    <dd className="flex flex-wrap items-baseline gap-x-2">
      <span className={field.status === "empty" ? "text-muted-foreground" : ""}>{field.status === "not_applicable" ? "Not applicable" : field.status === "not_yet" ? "Not yet" : shown || "Unanswered"}</span>
      {field.status === "suggested" && <span className="text-xs text-amber-600">suggested<Sources urls={field.suggestion?.sources ?? field.sources} /></span>}
      {field.status === "confirmed" && field.sources.length > 0 && <Sources urls={field.sources} />}
      {canEdit && field.status === "suggested" && <button type="button" disabled={busy} onClick={onConfirm} className="text-xs font-medium text-primary underline">Confirm</button>}
      {canEdit && <button type="button" id={`${id}-edit`} disabled={busy} onClick={onEdit} className="text-xs text-muted-foreground underline" aria-label={`Edit ${field.label}`}>Edit</button>}
    </dd>
  </div>;
}

function EditField({ id, field, busy, onCancel, onSave }: { id: string; field: FieldView; busy: boolean; onCancel: () => void; onSave: (value: unknown) => void }) {
  const [text, setText] = useState(() => field.suggestion?.value ?? toText(field.kind, field.value));
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const cancel = () => { onCancel(); requestAnimationFrame(() => document.getElementById(`${id}-edit`)?.focus()); };
  const hint = fieldFormat[field.kind] ?? field.hint;
  return <form className="space-y-1.5 rounded-lg border bg-background p-2" onSubmit={e => { e.preventDefault(); onSave(fromText(field.kind, text)); }}
    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); cancel(); } }}>
    <label htmlFor={id} className="text-xs font-medium">{field.label}</label>
    {field.choices ? <select id={id} autoFocus value={text} onChange={e => setText(e.target.value)} className="block w-full rounded-md border bg-background p-2"><option value="">Choose</option>{field.choices.map(c => <option key={c} value={c}>{c === "starting" ? "Starting from scratch" : c === "operating" ? "Already operating" : c.replaceAll("_", " ")}</option>)}</select> : multiline(field.kind) ? <Textarea id={id} ref={ref} rows={Math.min(8, Math.max(3, text.split("\n").length + 1))} value={text} onChange={e => setText(e.target.value)} />
      : <Input id={id} ref={ref} value={text} onChange={e => setText(e.target.value)} type={field.kind === "email" ? "email" : "text"} inputMode={field.kind === "url" ? "url" : undefined} />}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={busy}>Save</Button>
      {field.excludable && <>{([['not_applicable', 'Not applicable'], ['not_yet', 'Not yet'], ['empty', 'Leave unanswered']] as const).map(([status, label]) => <Button key={status} type="button" size="sm" variant="outline" disabled={busy} onClick={() => onSave({ fieldState: status })}>{label}</Button>)}</>}<Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button></div>
  </form>;
}
