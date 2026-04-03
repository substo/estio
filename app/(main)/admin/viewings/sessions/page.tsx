import Link from "next/link";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuickAssistStartButton } from "./_components/quick-assist-start-button";
import { VIEWING_SESSION_KINDS, VIEWING_SESSION_QUICK_START_SOURCES } from "@/lib/viewings/sessions/types";

export const dynamic = "force-dynamic";

function formatSessionKindLabel(value: string) {
    if (value === VIEWING_SESSION_KINDS.listenOnly) return "Listen";
    if (value === VIEWING_SESSION_KINDS.twoWayInterpreter) return "Two-way";
    if (value === VIEWING_SESSION_KINDS.quickTranslate) return "Quick Translate";
    return "Structured";
}

export default async function ViewingSessionsIndexPage() {
    const locationContext = await getLocationContext();
    const locationId = String(locationContext?.id || "").trim();

    if (!locationId) {
        return (
            <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:px-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Quick Field Assist</CardTitle>
                        <CardDescription>Select a location to launch or review quick sessions.</CardDescription>
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
                <h1 className="text-2xl font-semibold tracking-tight">Quick Field Assist</h1>
                <p className="text-sm text-muted-foreground">
                    Start private translation instantly, then attach CRM context only if the conversation becomes worth saving.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Quick Translate</CardTitle>
                        <CardDescription>One tap into private translation for agent-led conversations.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <QuickAssistStartButton
                            label="Start Quick Translate"
                            locationId={locationId}
                            sessionKind={VIEWING_SESSION_KINDS.quickTranslate}
                            quickStartSource={VIEWING_SESSION_QUICK_START_SOURCES.global}
                            size="default"
                            className="w-full"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Listen</CardTitle>
                        <CardDescription>Passive subtitle mode for conversations you need to understand in real time.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <QuickAssistStartButton
                            label="Start Listen Mode"
                            locationId={locationId}
                            sessionKind={VIEWING_SESSION_KINDS.listenOnly}
                            quickStartSource={VIEWING_SESSION_QUICK_START_SOURCES.global}
                            size="default"
                            className="w-full"
                            icon="radio"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Structured Viewing Copilot</CardTitle>
                        <CardDescription>Use the full viewing workflow when you already know the lead and property context.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button asChild variant="outline" className="w-full">
                            <Link href="/admin/contacts">
                                Open Contact Workflows
                            </Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Assignment Queue</CardTitle>
                        <CardDescription>Saved quick sessions waiting to be attached to a contact or property.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {unassignedSessions.length === 0 && (
                            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                No saved quick sessions are waiting for assignment.
                            </div>
                        )}
                        {unassignedSessions.map((session) => (
                            <Link
                                key={session.id}
                                href={`/admin/viewings/sessions/${session.id}`}
                                className="flex items-start justify-between gap-3 rounded-lg border px-4 py-3 transition hover:border-foreground/30 hover:bg-muted/20"
                            >
                                <div className="space-y-1">
                                    <div className="font-medium">
                                        {session.primaryProperty?.title || "Unattached quick session"}
                                    </div>
                                    <div className="text-sm text-muted-foreground">
                                        {session.contact?.name || session.contact?.firstName || "No contact attached"} • {formatSessionKindLabel(session.sessionKind)}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        Saved {session.endedAt ? new Date(session.endedAt).toLocaleString() : new Date(session.createdAt).toLocaleString()}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Badge variant="secondary">Needs assignment</Badge>
                                    <Badge variant="outline">{session.savePolicy}</Badge>
                                </div>
                            </Link>
                        ))}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base">Recent Quick Sessions</CardTitle>
                        <CardDescription>Resume active work or reopen recent field assist threads.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {recentQuickSessions.length === 0 && (
                            <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                                No recent quick sessions yet.
                            </div>
                        )}
                        {recentQuickSessions.map((session) => (
                            <Link
                                key={session.id}
                                href={`/admin/viewings/sessions/${session.id}`}
                                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition hover:border-foreground/30 hover:bg-muted/20"
                            >
                                <div className="space-y-1">
                                    <div className="font-medium">
                                        {session.primaryProperty?.title || session.contact?.name || session.clientName || "Quick field assist"}
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
