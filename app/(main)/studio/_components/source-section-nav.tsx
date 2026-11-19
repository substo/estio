const sections = [["transcript", "Transcript"], ["script", "Script"], ["knowledge", "Knowledge"], ["related", "Related videos"], ["notes", "My notes"]] as const;
/** In-page navigation: real anchors, so keyboard, deep links and back behaviour all work. */
export function SourceSectionNav({ only }: { only?: readonly string[] }) {
  return <nav aria-label="Sections of this source" className="sticky top-0 z-20 -mx-4 overflow-x-auto border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:mx-0 md:px-0">
    <ul className="flex min-w-max gap-1">{sections.filter(([id]) => !only || only.includes(id)).map(([id, label]) => <li key={id}><a href={`#${id}`} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">{label}</a></li>)}</ul>
  </nav>;
}
