import Link from "next/link";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button";
import { VIEWING_SESSION_KINDS, VIEWING_SESSION_MODES, VIEWING_SESSION_QUICK_START_SOURCES } from "@/lib/viewings/sessions/types";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 20;

type PageProps = {
    searchParams: Promise<{ filter?: string; page?: string }>;
};

function formatSessionKindLabel(value: string) {
    if (value === VIEWING_SESSION_KINDS.listenOnly) return "Transcribe";
    if (value === VIEWING_SESSION_KINDS.twoWayInterpreter) return "Translate";
    if (value === VIEWING_SESSION_KINDS.quickTranslate) return "Ask AI";
    return "Viewing";
}

export default async function ViewingSessionsIndexPage({ searchParams }: PageProps) {
    const params = await searchParams;
    const filter = params.filter === "unlinked" ? "unlinked" : "all";
    const requestedPage = Number(params.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const locationContext = await getLocationContext();
    const locationId = String(locationContext?.id || "").trim();

    if (!locationId) {
        return (
            <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Live Assist</CardTitle>
                        <CardDescription>Select a location to start or review sessions.</CardDescription>
                    </CardHeader>
                </Card>
            </div>
        );
    }

    const sessions = await db.viewingSession.findMany({
        where: {
            locationId,
            sessionKind: {
                in: [
                    VIEWING_SESSION_KINDS.quickTranslate,
                    VIEWING_SESSION_KINDS.listenOnly,
                    VIEWING_SESSION_KINDS.twoWayInterpreter,
                ],
            },
            ...(filter === "unlinked" ? {
                assignmentStatus: "unassigned",
                savePolicy: { not: "discard_on_close" },
            } : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
        select: {
            id: true,
            updatedAt: true,
            sessionKind: true,
            participantMode: true,
            status: true,
            assignmentStatus: true,
            savePolicy: true,
            clientName: true,
            contact: { select: { name: true, firstName: true } },
            primaryProperty: { select: { title: true } },
        },
    });
    const hasNextPage = sessions.length > PAGE_SIZE;
    const visibleSessions = sessions.slice(0, PAGE_SIZE);
    const pageHref = (targetPage: number) => {
        const query = new URLSearchParams();
        if (filter === "unlinked") query.set("filter", "unlinked");
        if (targetPage > 1) query.set("page", String(targetPage));
        const search = query.toString();
        return `/admin/live-assist${search ? `?${search}` : ""}`;
    };

    return (
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">Live Assist</h1>
                <p className="text-sm text-muted-foreground">
                    Translate, transcribe, or ask AI during a conversation. Link a contact or property when you need its context.
                </p>
            </div>

            <div className="grid gap-4">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Start a session</CardTitle>
                        <CardDescription>Choose Translate, Transcribe, or Ask AI after opening the session.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <QuickAssistStartButton
                            label="Start session"
                            locationId={locationId}
                            sessionKind={VIEWING_SESSION_KINDS.twoWayInterpreter}
                            mode={VIEWING_SESSION_MODES.assistantLiveTranslate}
                            quickStartSource={VIEWING_SESSION_QUICK_START_SOURCES.global}
                            size="default"
                            className="w-full"
                            icon="languages"
                        />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="space-y-3 pb-3">
                    <div>
                        <CardTitle className="text-base">Sessions</CardTitle>
                        <CardDescription>Resume active sessions or review past ones.</CardDescription>
                    </div>
                    <nav aria-label="Filter sessions" className="flex flex-wrap gap-2">
                        <Link href="/admin/live-assist" aria-current={filter === "all" ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-muted ${filter === "all" ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
                            All
                        </Link>
                        <Link href="/admin/live-assist?filter=unlinked" aria-current={filter === "unlinked" ? "page" : undefined} className={`rounded-md border px-3 py-1.5 text-sm font-medium transition hover:bg-muted ${filter === "unlinked" ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
                            Unlinked
                        </Link>
                    </nav>
                </CardHeader>
                <CardContent className="space-y-3">
                    {visibleSessions.length === 0 && (
                        <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                            {page > 1 ? "No sessions on this page." : filter === "unlinked" ? "No active or saved sessions need linking." : "No sessions yet. Start one above."}
                        </div>
                    )}
                    {visibleSessions.map((session) => (
                        <Link
                            key={session.id}
                            href={`/admin/live-assist/sessions/${session.id}`}
                            className="flex flex-col gap-2 rounded-lg border px-4 py-3 transition hover:border-foreground/30 hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                        >
                            <div className="space-y-1">
                                <div className="font-medium">
                                    {session.primaryProperty?.title || session.contact?.name || session.contact?.firstName || session.clientName || "Live Assist session"}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    {formatSessionKindLabel(session.sessionKind)} • {session.participantMode === "agent_only" ? "Private" : "Shared"}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {session.contact?.name || session.contact?.firstName || "No contact attached"} • Updated {new Date(session.updatedAt).toLocaleString()}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {session.assignmentStatus === "unassigned" && session.savePolicy !== "discard_on_close" && (
                                    <Badge variant="secondary">Needs linking</Badge>
                                )}
                                <Badge variant={session.status === "active" ? "default" : "outline"}>
                                    {session.status}
                                </Badge>
                            </div>
                        </Link>
                    ))}
                    {(page > 1 || hasNextPage) && (
                        <nav aria-label="Session pages" className="flex items-center justify-between gap-3 pt-2 text-sm">
                            {page > 1 ? <Link href={pageHref(page - 1)} className="rounded-md border px-3 py-1.5 hover:bg-muted">Previous</Link> : <span />}
                            <span className="text-muted-foreground">Page {page}</span>
                            {hasNextPage ? <Link href={pageHref(page + 1)} className="rounded-md border px-3 py-1.5 hover:bg-muted">Next</Link> : <span />}
                        </nav>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
