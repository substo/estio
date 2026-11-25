import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { CAPABILITY_LABELS, CONNECTIONS, platformsFor, type Capability, type ConnectionId, type ConnectionPrefsMap } from "@/lib/studio/ai/connections";
import type { ConnectionState } from "@/lib/studio/ai/connections-store";

/** The same list at the top of every type's page: which platforms can make this, and which of them are connected and switched on. Keys are added on Connections. */
export function PlatformStatus({ capabilities, states, prefs }: { capabilities: Capability[]; states: ConnectionState[]; prefs: ConnectionPrefsMap }) {
  const connected = Object.fromEntries(states.map(s => [s.id, Boolean(s.hint)])) as Partial<Record<ConnectionId, boolean>>;
  const hint = (id: ConnectionId) => states.find(s => s.id === id)?.hint ?? null;
  const rows = [...new Map(capabilities.flatMap(c => platformsFor(c, connected, prefs).map(p => [p.id, { ...p, caps: capabilities.filter(k => CONNECTIONS[p.id].supports.includes(k)) }] as const))).values()];
  const ready = rows.filter(r => r.connected && r.caps.some(c => platformsFor(c, connected, prefs).find(p => p.id === r.id)?.enabled)).length;
  return <section aria-label="Platforms" className="space-y-2 rounded-lg border p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold">Platforms</h2>
      <p className="text-xs text-muted-foreground">{ready} ready · <Link href="/settings/ai/connections" className="text-primary hover:underline">Manage connections</Link></p></div>
    <ul className="divide-y">{rows.map(r => { const off = r.connected && !r.caps.some(c => platformsFor(c, connected, prefs).find(p => p.id === r.id)?.enabled);
      return <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
        {r.connected && !off ? <CheckCircle2 aria-hidden className="h-4 w-4 text-emerald-600" /> : <CircleDashed aria-hidden className="h-4 w-4 text-muted-foreground" />}
        <span className="min-w-40 font-medium">{CONNECTIONS[r.id].label}</span>
        <span className="text-xs text-muted-foreground">{r.caps.map(c => CAPABILITY_LABELS[c]).join(" · ")}</span>
        <span className="ml-auto text-xs">{!r.connected ? <Link href={`/settings/ai/connections#${r.id}`} className="text-primary hover:underline">Needs a key: add it</Link>
          : off ? <Link href={`/settings/ai/connections#${r.id}`} className="text-amber-700 hover:underline dark:text-amber-400">Switched off for this: turn it on</Link>
          : <span className="text-emerald-700 dark:text-emerald-400">Connected · key ends {hint(r.id)}</span>}</span>
      </li>; })}</ul>
  </section>;
}
