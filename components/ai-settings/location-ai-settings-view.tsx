"use client";
import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AiClientConnection, AiConnectionStatus } from "@/lib/ai/connections-model";
import type { AiRouteStep } from "@/lib/ai/routing";
import type { LocationAiRoutingView } from "@/lib/ai/routing-service";
import type { AiConnectionKind, AiTaskFamily } from "@/lib/ai/workflow-capabilities";
import {
  AI_KIND_LABELS, STATUS_LABELS, TASK_FAMILIES, TASK_FAMILY_LABELS, addStep, defaultChain, formatReset, formatUsdMicros, isPaidKind,
  kindsForFamily, missingKinds, modelOptions, moveStep, providerModelLabel, removeStep, routingPayload, sameRouting, setStepModel,
  setTaskModel, summarizeKinds, type KindSummary, type TaskDefaults,
} from "./settings-model";

/** Where each connection is connected or managed. Omit a link the current app can't open; the row then says where it lives. */
export type AiSettingsLinks = {
  /** Mac pairing and setup (Codex/Claude on the viewer's own Mac). */
  computer: string;
  chatgpt?: string;
  gemini?: string;
};
export type LocationAiSettingsProps = {
  locationId: string;
  routing: LocationAiRoutingView;
  /** The Location OpenAI key summary (never the key). */
  openAiKey: { keyHint: string } | null;
  encryptionReady: boolean;
  links: AiSettingsLinks;
  /** Defaults to the shared routing endpoint. */
  apiPath?: string;
};
/** Rendered slots for the Location API key and monthly cap forms (the wrapper passes the shared server-action forms). */
export type LocationAiSettingsSlots = { keyForm?: React.ReactNode; geminiKeyForm?: React.ReactNode; budgetForm?: React.ReactNode };

const DEFAULT_MODEL = "__default";
const statusClass: Record<AiConnectionStatus, string> = {
  ready: "border-transparent bg-emerald-600 text-white hover:bg-emerald-600",
  limit_reached: "border-transparent bg-amber-500 text-black hover:bg-amber-500",
  unavailable: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary",
  offline: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary",
  not_connected: "text-muted-foreground",
};
export function StatusBadge({ status, resetsAt }: { status: AiConnectionStatus; resetsAt?: string }) {
  const reset = status === "limit_reached" ? formatReset(resetsAt) : null;
  return <Badge variant="outline" className={cn("whitespace-nowrap", statusClass[status])}>{STATUS_LABELS[status]}{reset ? ` · resets ${reset}` : ""}</Badge>;
}
const PaidBadge = () => <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">paid</Badge>;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="space-y-1">
      <h2 id={`${id}-title`} className="text-lg font-medium">{title}</h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
    {children}
  </section>;
}

/**
 * The Location AI settings screen for Estio CRM and Studio, without the server-action forms (pass them as slots). Use
 * <LocationAiSettings> from ./location-ai-settings in pages. Editing needs `routing.canManage`; everyone else sees a read-only view.
 */
export function LocationAiSettingsView({ locationId, routing: initial, openAiKey, encryptionReady, links, apiPath = "/api/studio/ai-routing", keyForm, geminiKeyForm, budgetForm }: LocationAiSettingsProps & LocationAiSettingsSlots) {
  const [previousInitial, setPreviousInitial] = useState(initial);
  const [routing, setRouting] = useState(initial);
  const [chain, setChain] = useState<AiRouteStep[]>(initial.chain);
  const [taskDefaults, setTaskDefaults] = useState<TaskDefaults>(initial.taskDefaults);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ error?: string; saved?: string; conflict?: boolean }>({});
  const [announcement, setAnnouncement] = useState("");
  const canManage = routing.canManage;
  const kinds = summarizeKinds(routing.connections);
  const dirty = !sameRouting({ chain, taskDefaults }, routing);
  if (initial !== previousInitial) {
    setPreviousInitial(initial);
    // Server actions refresh connection and budget data. Preserve unsaved routing edits and their version fence.
    if (dirty || initial.version < routing.version) {
      setRouting({ ...routing, connections: initial.connections, budget: initial.budget, canManage: initial.canManage });
    } else {
      setRouting(initial);
      setChain(initial.chain);
      setTaskDefaults(initial.taskDefaults);
    }
  }
  const edit = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setResult({}); };

  async function request(init?: RequestInit) {
    const response = await fetch(apiPath, { cache: "no-store", ...init, headers: { "X-Studio-Tenant": locationId, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }
  function apply(view: LocationAiRoutingView) { setRouting(view); setChain(view.chain); setTaskDefaults(view.taskDefaults); }

  async function save() {
    setSaving(true); setResult({});
    try {
      const { ok, status, body } = await request({ method: "PUT", body: JSON.stringify(routingPayload(chain, taskDefaults, routing.version)) });
      if (ok) { apply(body as LocationAiRoutingView); setResult({ saved: "AI order and models saved." }); }
      else setResult({ error: typeof body.error === "string" ? body.error : "Could not save. Try again.", conflict: status === 409 });
    } catch { setResult({ error: "Could not reach the server. Check your connection and try again." }); }
    finally { setSaving(false); }
  }
  async function reload() {
    setSaving(true);
    try { const { ok, body } = await request(); if (ok) { apply(body as LocationAiRoutingView); setResult({ saved: "Reloaded the latest settings." }); } else setResult({ error: "Could not reload. Refresh the page." }); }
    catch { setResult({ error: "Could not reload. Refresh the page." }); }
    finally { setSaving(false); }
  }

  return <div className="space-y-6">
    {!canManage ? <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">View only. Only a Location admin, signed in as themselves, can change AI settings.</p> : null}
    <ConnectionsSection connections={routing.connections} kinds={kinds} links={links} canManage={canManage} openAiKey={openAiKey} encryptionReady={encryptionReady} keyForm={keyForm} geminiKeyForm={geminiKeyForm} />
    <div className="space-y-6" inert={saving}>
      <ModelsSection chain={chain} taskDefaults={taskDefaults} kinds={kinds} canManage={canManage} onChange={edit(setTaskDefaults)} />
      <OrderSection chain={chain} saved={routing.saved || dirty} kinds={kinds} canManage={canManage} capMicros={routing.budget.capMicros} onChange={edit(setChain)} announce={setAnnouncement} />
    </div>
    <p aria-live="polite" className="sr-only">{announcement}</p>
    {canManage ? <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border bg-background p-3", dirty && "sticky bottom-2 z-10 shadow-md")}>
      <Button type="button" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save order and models"}</Button>
      {dirty ? <Button type="button" variant="ghost" onClick={() => { setChain(routing.chain); setTaskDefaults(routing.taskDefaults); setResult({}); }} disabled={saving}>Discard changes</Button> : null}
      {result.error ? <p role="alert" className="text-sm text-destructive">{result.error}{result.conflict ? <> <Button type="button" variant="link" size="sm" className="h-auto px-1" onClick={reload}>Reload</Button></> : null}</p>
        : result.saved ? <p role="status" className="text-sm text-muted-foreground">{result.saved}</p>
        : dirty ? <p className="text-sm text-muted-foreground">Unsaved changes</p> : null}
    </div> : null}
    <UsageSection routing={routing} canManage={canManage} budgetForm={budgetForm} />
  </div>;
}

function scopeNote(connection: AiClientConnection | null, kind: AiConnectionKind) {
  if (connection?.scope === "device" || !connection && (kind === "device_codex" || kind === "device_claude")) return "Your Mac";
  return isPaidKind(kind) ? "Location API key" : "Location subscription";
}
function ManageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline">{children}</Link>;
}

function ConnectionsSection({ connections, kinds, links, canManage, openAiKey, encryptionReady, keyForm, geminiKeyForm }: {
  connections: AiClientConnection[]; kinds: Record<AiConnectionKind, KindSummary>; links: AiSettingsLinks; canManage: boolean;
  openAiKey: { keyHint: string } | null; encryptionReady: boolean; keyForm?: React.ReactNode; geminiKeyForm?: React.ReactNode;
}) {
  const ownDevices = connections.filter(c => c.scope === "device" && c.mine !== false);
  const rows: { key: string; kind: AiConnectionKind; label: string; connection: AiClientConnection | null }[] = [
    ...(["openai_key", "gemini_key", "chatgpt_subscription"] as const).map(kind => ({ key: kind, kind, label: connections.find(c => c.id === kind)?.label ?? AI_KIND_LABELS[kind], connection: connections.find(c => c.id === kind) ?? null })),
    ...ownDevices.map(c => ({ key: c.id, kind: c.kind, label: c.label, connection: c })),
    ...(["device_codex", "device_claude"] as const).filter(kind => !ownDevices.some(c => c.kind === kind))
      .map(kind => ({ key: kind, kind, label: `${AI_KIND_LABELS[kind]} on your Mac`, connection: null })),
  ];
  return <Section id="ai-connections" title="Connections" description="Subscriptions and API keys this Location can use. Mac subscriptions shown are your own.">
    <ul className="divide-y rounded-lg border">
      {rows.map(row => {
        const status = row.connection?.status ?? kinds[row.kind].status;
        const reason = row.connection ? row.connection.reason : row.kind.startsWith("device_") ? "Not set up on your Mac" : "Not connected";
        return <li key={row.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.label}</span>
              {isPaidKind(row.kind) ? <PaidBadge /> : null}
              <StatusBadge status={status} resetsAt={row.connection?.resetsAt} />
            </div>
            <p className="text-xs text-muted-foreground">{scopeNote(row.connection, row.kind)}{reason && status !== "ready" ? ` · ${reason}` : ""}
              {row.kind === "openai_key" && openAiKey ? ` · key ending …${openAiKey.keyHint}` : ""}</p>
          </div>
          <div className="shrink-0">
            {row.kind === "openai_key" ? <AiKeyManage canManage={canManage} hasKey={!!openAiKey} encryptionReady={encryptionReady} form={keyForm} />
              : row.kind === "gemini_key" && geminiKeyForm ? <AiKeyManage canManage={canManage} hasKey={status === "ready"} encryptionReady={encryptionReady} form={geminiKeyForm} />
              : row.kind === "device_codex" || row.kind === "device_claude" ? <ManageLink href={links.computer}>{row.connection ? "Manage Mac" : "Set up your Mac"}</ManageLink>
              : (row.kind === "gemini_key" ? links.gemini : links.chatgpt) ? <ManageLink href={(row.kind === "gemini_key" ? links.gemini : links.chatgpt)!}>{status === "not_connected" ? "Connect" : "Manage"}</ManageLink>
              : <span className="text-xs text-muted-foreground">Managed in Estio settings</span>}
          </div>
        </li>;
      })}
    </ul>
  </Section>;
}

function AiKeyManage({ canManage, hasKey, encryptionReady, form }: { canManage: boolean; hasKey: boolean; encryptionReady: boolean; form?: React.ReactNode }) {
  if (!canManage || !form) return null;
  if (!encryptionReady) return <span className="text-xs text-muted-foreground">Secure key storage isn&apos;t configured on this server.</span>;
  return <Collapsible className="sm:w-72">
    <CollapsibleTrigger asChild><Button type="button" variant="link" size="sm" className="group h-9 px-0">{hasKey ? "Replace or remove key" : "Add key"}<ChevronDown aria-hidden className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
    <CollapsibleContent className="pt-2">{form}</CollapsibleContent>
  </Collapsible>;
}

function ModelSelect({ id, kind, summary, value, disabled, onChange, defaultLabel }: {
  id: string; kind: AiConnectionKind; summary: KindSummary; value: string | null | undefined; disabled: boolean; onChange: (model: string | null) => void; defaultLabel: string;
}) {
  const options = modelOptions(summary, value);
  return <Select value={value || DEFAULT_MODEL} onValueChange={v => onChange(v === DEFAULT_MODEL ? null : v)} disabled={disabled}>
    <SelectTrigger id={id} className="w-full min-w-0 sm:w-64 [&>span]:truncate"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value={DEFAULT_MODEL}>{providerModelLabel(kind, defaultLabel)}</SelectItem>
      {options.map(m => <SelectItem key={m.id} value={m.id}>{providerModelLabel(kind, m)}</SelectItem>)}
    </SelectContent>
  </Select>;
}

function ModelsSection({ chain, taskDefaults, kinds, canManage, onChange }: {
  chain: AiRouteStep[]; taskDefaults: TaskDefaults; kinds: Record<AiConnectionKind, KindSummary>; canManage: boolean; onChange: (next: TaskDefaults) => void;
}) {
  const id = useId();
  return <Section id="ai-models" title="Models per task" description="Which model each connection uses for a kind of work. Default uses the order's model, then the connection's own default.">
    <p className="text-xs text-muted-foreground">Structured Studio tasks using the OpenAI API run on the metered gpt-6-luna model. OpenAI model selections apply to compatible CRM and onboarding tasks.</p>
    <ul className="space-y-4">
      {TASK_FAMILIES.map((family: AiTaskFamily) => {
        const eligible = kindsForFamily(family);
        const steps = chain.filter(s => eligible.includes(s.kind));
        const info = TASK_FAMILY_LABELS[family];
        return <li key={family} className="space-y-2 border-b pb-4 last:border-b-0 last:pb-0">
          <div><h3 className="text-sm font-medium">{info.label}</h3><p className="text-xs text-muted-foreground">{info.description}</p></div>
          {steps.length ? <div className="space-y-2">
            {steps.map(step => {
              const fieldId = `${id}-${family}-${step.kind}`;
              return <div key={step.kind} className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <Label htmlFor={fieldId} className="sm:w-36">{AI_KIND_LABELS[step.kind]} model</Label>
                <ModelSelect id={fieldId} kind={step.kind} summary={kinds[step.kind]} value={taskDefaults[family]?.[step.kind]} disabled={!canManage}
                  defaultLabel={step.model ? `order default (${step.model})` : "default"} onChange={model => onChange(setTaskModel(taskDefaults, family, step.kind, model))} />
                <StatusBadge status={kinds[step.kind].status} resetsAt={kinds[step.kind].resetsAt} />
              </div>;
            })}
          </div> : <p className="text-sm text-muted-foreground">Nothing in the fallback order can run this. Add {eligible.map(k => AI_KIND_LABELS[k]).join(" or ")} to the order.</p>}
        </li>;
      })}
    </ul>
  </Section>;
}

function OrderSection({ chain, saved, kinds, canManage, capMicros, onChange, announce }: {
  chain: AiRouteStep[]; saved: boolean; kinds: Record<AiConnectionKind, KindSummary>; canManage: boolean; capMicros: number;
  onChange: (next: AiRouteStep[]) => void; announce: (message: string) => void;
}) {
  const id = useId();
  const buttons = useRef(new Map<string, HTMLButtonElement | null>());
  const [adding, setAdding] = useState<AiConnectionKind | "">("");
  const addable = missingKinds(chain);
  const hasPaid = chain.some(s => isPaidKind(s.kind));
  function move(index: number, delta: -1 | 1) {
    const next = moveStep(chain, index, delta);
    if (next === chain) return;
    const kind = chain[index].kind; const position = index + delta;
    onChange(next);
    announce(`${AI_KIND_LABELS[kind]} moved to position ${position + 1} of ${chain.length}.`);
    // Keep focus on the moved step; at an end, the pressed button disables, so focus its sibling.
    const atEnd = delta === -1 ? position === 0 : position === chain.length - 1;
    requestAnimationFrame(() => buttons.current.get(`${kind}:${atEnd ? (delta === -1 ? "down" : "up") : (delta === -1 ? "up" : "down")}`)?.focus());
  }
  function onRowKey(event: KeyboardEvent<HTMLLIElement>, index: number) {
    if (!canManage || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault(); move(index, event.key === "ArrowUp" ? -1 : 1);
  }
  return <Section id="ai-order" title="Fallback order" description="Requests that follow this order skip connections that cannot run the task or are out of capacity or budget.">
    <p className="text-sm">Fallback can use the requester&apos;s own Mac and Location connections, never a teammate&apos;s subscription.</p>
    {!saved ? <p className="text-sm text-muted-foreground">This is the default order: no paid steps.</p> : null}
    {chain.length ? <ol className="space-y-2" aria-describedby={canManage ? `${id}-keys` : undefined}>
      {chain.map((step, index) => {
        const summary = kinds[step.kind];
        return <li key={step.kind} onKeyDown={event => onRowKey(event, index)} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}.</span>
            <span className="font-medium">{summary.label}</span>
            {summary.personal ? <span className="text-xs text-muted-foreground">your Mac</span> : null}
            {summary.paid ? <PaidBadge /> : null}
            <StatusBadge status={summary.status} resetsAt={summary.resetsAt} />
            {step.model ? <span className="text-xs text-muted-foreground">{providerModelLabel(step.kind, step.model)}</span> : null}
          </div>
          {canManage ? <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={`Move ${summary.label} up`} disabled={index === 0}
              ref={el => { buttons.current.set(`${step.kind}:up`, el); }} onClick={() => move(index, -1)}><ArrowUp aria-hidden className="h-4 w-4" /></Button>
            <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label={`Move ${summary.label} down`} disabled={index === chain.length - 1}
              ref={el => { buttons.current.set(`${step.kind}:down`, el); }} onClick={() => move(index, 1)}><ArrowDown aria-hidden className="h-4 w-4" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label={`Remove ${summary.label} from the order`}
              onClick={() => { onChange(removeStep(chain, index)); announce(`${summary.label} removed from the order.`); }}><X aria-hidden className="h-4 w-4" /></Button>
          </div> : null}
        </li>;
      })}
    </ol> : <p role="alert" className="text-sm text-destructive">The order is empty, so no AI request can run. Add a connection.</p>}
    {canManage ? <p id={`${id}-keys`} className="text-xs text-muted-foreground">Keyboard: Alt + Up or Down arrow moves the focused step.</p> : null}
    {hasPaid && capMicros <= 0 ? <p className="text-sm text-amber-700 dark:text-amber-400">The monthly cap is $0, so paid steps are skipped. Set a cap under Usage &amp; limits.</p> : null}
    {canManage ? <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      {addable.length ? <div className="space-y-1">
        <Label htmlFor={`${id}-add`}>Add a connection</Label>
        <div className="flex gap-2">
          <Select value={adding} onValueChange={v => setAdding(v as AiConnectionKind)}>
            <SelectTrigger id={`${id}-add`} className="w-full sm:w-56"><SelectValue placeholder="Choose a connection" /></SelectTrigger>
            <SelectContent>{addable.map(kind => <SelectItem key={kind} value={kind}>{AI_KIND_LABELS[kind]}{isPaidKind(kind) ? " (paid)" : ""} · {STATUS_LABELS[kinds[kind].status]}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="outline" disabled={!adding} onClick={() => { if (adding) { onChange(addStep(chain, adding)); announce(`${AI_KIND_LABELS[adding]} added at the end.`); setAdding(""); } }}>Add</Button>
        </div>
      </div> : null}
      <Button type="button" variant="ghost" onClick={() => { onChange(defaultChain()); announce("Default order restored."); }}>Restore default order</Button>
    </div> : null}
    {canManage && chain.length ? <Collapsible>
      <CollapsibleTrigger asChild><Button type="button" variant="link" size="sm" className="group h-9 px-0">Advanced: model per step<ChevronDown aria-hidden className="ml-1 h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        <p className="text-xs text-muted-foreground">Used for every task unless Models per task sets one.</p>
        {chain.map((step, index) => <div key={step.kind} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Label htmlFor={`${id}-step-${step.kind}`} className="sm:w-36">{AI_KIND_LABELS[step.kind]}</Label>
          <ModelSelect id={`${id}-step-${step.kind}`} kind={step.kind} summary={kinds[step.kind]} value={step.model} disabled={false} defaultLabel="connection default"
            onChange={model => onChange(setStepModel(chain, index, model))} />
        </div>)}
      </CollapsibleContent>
    </Collapsible> : null}
  </Section>;
}

function UsageSection({ routing, canManage, budgetForm }: { routing: LocationAiRoutingView; canManage: boolean; budgetForm?: React.ReactNode }) {
  const { capMicros, spentMicros, heldMicros } = routing.budget;
  const used = spentMicros + heldMicros;
  const percent = capMicros > 0 ? Math.min(100, Math.round((used / capMicros) * 100)) : 0;
  const subscriptions = routing.connections.filter(c => !c.paid && c.status !== "not_connected" && (c.scope !== "device" || c.mine !== false));
  return <Section id="ai-usage" title="Usage & limits" description="Paid steps share one monthly cap for this Location (UTC month). Subscriptions have their own limits.">
    <div className="space-y-2">
      <p className="text-sm"><span className="font-medium">{formatUsdMicros(spentMicros)}</span> spent{heldMicros ? <>, <span className="font-medium">{formatUsdMicros(heldMicros)}</span> reserved for running work</> : null} of <span className="font-medium">{formatUsdMicros(capMicros)}</span> this month</p>
      {capMicros > 0 ? <Progress value={percent} aria-label={`${percent}% of the monthly cap used`} className="h-2" /> : <p className="text-sm text-muted-foreground">No cap set: paid steps are skipped.</p>}
    </div>
    {canManage ? budgetForm : null}
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Subscriptions</h3>
      {subscriptions.length ? <ul className="space-y-1 text-sm">
        {subscriptions.map(c => {
          const reset = formatReset(c.usageResetsAt ?? c.resetsAt);
          return <li key={c.id} className="flex flex-wrap items-center gap-2">
            <span>{c.label}</span>
            <span className="text-muted-foreground">{c.remainingPercent !== undefined ? `${Math.round(c.remainingPercent)}% left` : "Remaining not reported"}{reset ? ` · resets ${reset}` : ""}</span>
          </li>;
        })}
      </ul> : <p className="text-sm text-muted-foreground">No subscription is connected yet.</p>}
    </div>
  </Section>;
}
