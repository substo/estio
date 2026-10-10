import Link from "next/link";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QuickAssistStartButton } from "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button";
import { VIEWING_SESSION_KINDS, VIEWING_SESSION_MODES, VIEWING_SESSION_QUICK_START_SOURCES } from "@/lib/viewings/sessions/types";

export const dynamic = "force-dynamic";

function formatSessionKindLabel(value: string) {
    if (value === VIEWING_SESSION_KINDS.listenOnly) return "Transcribe";
    if (value === VIEWING_SESSION_KINDS.twoWayInterpreter) return "Translate";
    if (value === VIEWING_SESSION_KINDS.quickTranslate) return "Ask AI";
    return "Viewing";
}

export default async function ViewingSessionsIndexPage() {
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

    const [unassignedSessions, recentQuickSessions] = await Promise.all([
        db.viewingSession.findMany({
            where: {
                locationId,
                assignmentStatus: "unassigned",
                savePolicy: { not: "discard_on_close" },
                sessionKind: {
                    in: [
                        VIEWING_SESSION_KINDS.quickTranslate,
                        VIEWING_SESSION_KINDS.listenOnly,
                        VIEWING_SESSION_KINDS.twoWayInterpreter,
                    ],
                },
            },
            orderBy: [{ endedAt: "desc" }, { createdAt: "desc" }],
            take: 20,
            include: {
                contact: { select: { id: true, name: true, firstName: true } },
                primaryProperty: { select: { id: true, title: true, reference: true } },
            },
        }),
        db.viewingSession.findMany({
            where: {
                locationId,
                sessionKind: {
                    in: [
                        VIEWING_SESSION_KINDS.quickTranslate,
                        VIEWING_SESSION_KINDS.listenOnly,
                        VIEWING_SESSION_KINDS.twoWayInterpreter,
                    ],
                },
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 12,
            include: {
                contact: { select: { id: true, name: true, firstName: true } },
                primaryProperty: { select: { id: true, title: true, reference: true } },
            },
        }),
    ]);

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

            <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Sessions to link</CardTitle>
                        <CardDescription>Saved sessions waiting to be linked to a contact or property.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {unassignedSessions.length === 0 && (
                            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                No saved sessions need linking.
                            </div>
                        )}
                        {unassignedSessions.map((session) => (
                            <Link
                                key={session.id}
                                href={`/admin/live-assist/sessions/${session.id}`}
                                className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 transition hover:border-foreground/30 hover:bg-muted/20"
                            >
                                <div className="space-y-1">
                                    <div className="font-medium">
                                        {session.primaryProperty?.title || "Unlinked session"}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        {session.contact?.name || session.contact?.firstName || "No contact attached"} • {formatSessionKindLabel(session.sessionKind)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Saved {session.endedAt ? new Date(session.endedAt).toLocaleString() : new Date(session.createdAt).toLocaleString()}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary">Needs linking</Badge>
                                    <Badge variant="outline">{session.savePolicy}</Badge>
                                </div>
                            </Link>
                        ))}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Recent sessions</CardTitle>
                        <CardDescription>Resume active sessions or reopen recent ones.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {recentQuickSessions.length === 0 && (
                            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                No recent sessions yet.
                            </div>
                        )}
                        {recentQuickSessions.map((session) => (
                            <Link
                                key={session.id}
                                href={`/admin/live-assist/sessions/${session.id}`}
                                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition hover:border-foreground/30 hover:bg-muted/20"
                            >
                                <div className="space-y-1">
                                    <div className="font-medium">
                                        {session.primaryProperty?.title || session.contact?.name || session.clientName || "Live Assist session"}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        {formatSessionKindLabel(session.sessionKind)} • {session.participantMode === "agent_only" ? "Private" : "Shared"} • {session.status}
                                    </div>
                                </div>
                                <Badge variant={session.status === "active" ? "default" : "outline"}>
                                    {session.status}
                                </Badge>
                            </Link>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
