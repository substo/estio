import { CONNECTIONS, CONNECTION_IDS } from "@/lib/studio/ai/connections";
import { getConnections } from "@/lib/studio/ai/connections-store";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { ConnectionCard } from "../_components/connection-card";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Connections" };

export default async function AiConnectionsPage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const view = await getConnections(locationId);
  const connected = view.states.filter(s => s.hint).length;
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Every AI platform you pay for, in one place. Add a key once; then choose what each platform is used for and which of its models are allowed. Voice, Music and sound effects, and Images only offer what you connect and allow here. {connected} of {CONNECTION_IDS.length} connected.</p>
    <ul className="space-y-3">{view.states.map(s => <ConnectionCard key={s.id} locationId={locationId} platform={CONNECTIONS[s.id]} hint={s.hint} prefs={s.prefs} canManage={view.canManage} />)}</ul>
  </main>;
}
