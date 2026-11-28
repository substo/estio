"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";

export type SourceTab = { id: string; label: string; badge?: string; pageScroll?: boolean; panel: React.ReactNode };
export const OPEN_TAB_EVENT = "studio:open-tab";
const RELATED_SEARCH_EVENT = "studio:related-search";

/** Horizontal tabs: one panel at a time so the page never needs scrolling between tasks. Panels stay mounted (state survives). */
export function SourceTabs({ tabs, initial }: { tabs: SourceTab[]; initial?: string }) {
  const base = useId();
  const [active, setActive] = useState(initial && tabs.some(tab => tab.id === initial) ? initial : tabs[0]!.id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const select = useCallback((id: string) => { setActive(id); if (typeof history !== "undefined") history.replaceState(null, "", `#${id}`); }, []);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash && tabs.some(tab => tab.id === hash)) setActive(hash);
    const open = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (tabs.some(tab => tab.id === id)) select(id); };
    const related = () => { if (tabs.some(tab => tab.id === "related")) select("related"); };
    window.addEventListener(OPEN_TAB_EVENT, open); window.addEventListener(RELATED_SEARCH_EVENT, related);
    return () => { window.removeEventListener(OPEN_TAB_EVENT, open); window.removeEventListener(RELATED_SEARCH_EVENT, related); };
  }, [tabs, select]);
  function onKey(event: React.KeyboardEvent) {
    const index = tabs.findIndex(tab => tab.id === active);
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); const id = tabs[next]!.id; select(id); refs.current[id]?.focus();
  }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div role="tablist" aria-label="Sections of this source" onKeyDown={onKey} className="flex shrink-0 gap-1 overflow-x-auto border-b">
      {tabs.map(tab => <button key={tab.id} ref={node => { refs.current[tab.id] = node; }} role="tab" type="button" id={`${base}-t-${tab.id}`} aria-selected={active === tab.id} aria-controls={`${base}-p-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => select(tab.id)}
        className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${active === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
        {tab.label}{tab.badge ? <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{tab.badge}</span> : null}
      </button>)}
    </div>
    {tabs.map(tab => <div key={tab.id} role="tabpanel" id={`${base}-p-${tab.id}`} aria-labelledby={`${base}-t-${tab.id}`} hidden={active !== tab.id} tabIndex={0} className={`min-h-0 flex-1 py-4 focus-visible:outline-none ${tab.pageScroll ? "" : "overflow-y-auto lg:max-h-[calc(100dvh-22rem)] lg:min-h-[16rem]"}`}>{tab.panel}</div>)}
  </div>;
}
