"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pause, Play, RefreshCw, Send, Sparkles, SquareCheckBig } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { completeViewingSession, pauseViewingSession, startViewingSession } from "@/app/(main)/admin/viewings/sessions/actions";

type SessionMessage = {
    id: string;
    speaker: string;
    originalText: string;
    originalLanguage: string | null;
    translatedText: string | null;
    targetLanguage: string | null;
    confidence: number | null;
    analysisStatus: string;
    timestamp: string;
    createdAt: string;
};

type SessionInsight = {
    id: string;
    type: string;
    category: string | null;
    shortText: string;
    longText: string | null;
    state: string;
    source: string;
    confidence: number | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
};

type SessionSummary = {
    id: string;
    status: string;
    sessionSummary: string | null;
    crmNote: string | null;
    followUpWhatsApp: string | null;
    followUpEmail: string | null;
    recommendedNextActions: string[];
    likes: string[];
    dislikes: string[];
    objections: string[];
    buyingSignals: string[];
    generatedAt: string | null;
};

type SessionState = {
    id: string;
    locationId: string;
    status: string;
    mode: string;
    liveModel: string | null;
    chainIndex: number;
    startedAt: string | null;
    endedAt: string | null;
    clientName: string | null;
    clientLanguage: string | null;
    agentLanguage: string | null;
    audioPlaybackClientEnabled: boolean;
    audioPlaybackAgentEnabled: boolean;
    viewing: {
        id: string;
        date: string;
        property: { id: string; title: string; reference: string | null };
        contact: { id: string; name: string | null };
        user: { id: string; name: string | null };
    };
};

type Props = {
    initialSession: SessionState;
    initialMessages: SessionMessage[];
    initialInsights: SessionInsight[];
    initialSummary: SessionSummary | null;
};

function formatSpeakerLabel(speaker: string) {
    if (speaker === "client") return "Client";
    if (speaker === "agent") return "Agent";
    return "System";
}

function formatSessionStatus(status: string) {
    if (status === "active") return "Active";
    if (status === "paused") return "Paused";
    if (status === "completed") return "Completed";
    if (status === "expired") return "Expired";
    return "Scheduled";
}

function mergeInsightById(current: SessionInsight[], incoming: SessionInsight) {
    const idx = current.findIndex((item) => item.id === incoming.id);
    if (idx < 0) {
        return [incoming, ...current];
    }
    const next = [...current];
    next[idx] = { ...next[idx], ...incoming };
    return next;
}

export function ViewingSessionCockpit(props: Props) {
    const [session, setSession] = useState<SessionState>(props.initialSession);
    const [messages, setMessages] = useState<SessionMessage[]>(props.initialMessages);
    const [insights, setInsights] = useState<SessionInsight[]>(props.initialInsights);
    const [summary, setSummary] = useState<SessionSummary | null>(props.initialSummary);
    const [agentDraft, setAgentDraft] = useState("");
    const [liveInfo, setLiveInfo] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [statusPending, startStatusTransition] = useTransition();
    const [messagePending, setMessagePending] = useState(false);
    const [livePending, setLivePending] = useState(false);

    const activeSessionId = session.id;
    const orderedMessages = useMemo(
        () => [...messages].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp)),
        [messages]
    );
    const activeInsights = useMemo(
        () => insights.filter((item) => item.state !== "dismissed"),
        [insights]
    );

    useEffect(() => {
        const source = new EventSource(`/api/viewings/sessions/events?sessionId=${encodeURIComponent(activeSessionId)}`);

        const onRealtime = (event: MessageEvent) => {
            try {
                const envelope = JSON.parse(event.data || "{}");
                const type = String(envelope?.type || "");
                const payload = envelope?.payload || {};

                if (type === "viewing_session.message.created" && payload?.message) {
                    const incoming = payload.message as SessionMessage;
                    setMessages((current) => {
                        if (current.some((item) => item.id === incoming.id)) return current;
                        return [...current, incoming];
                    });
                    return;
                }

                if (type === "viewing_session.message.updated" && payload?.message?.id) {
                    const patch = payload.message as Partial<SessionMessage> & { id: string };
                    setMessages((current) =>
                        current.map((item) => (item.id === patch.id ? { ...item, ...patch } : item))
                    );
                    return;
                }

                if (type === "viewing_session.insight.upserted" && Array.isArray(payload?.insights)) {
                    setInsights((current) => {
                        let next = current;
                        for (const insight of payload.insights as SessionInsight[]) {
                            next = mergeInsightById(next, insight);
                        }
                        return next;
                    });
                    return;
                }

                if (type === "viewing_session.summary.updated" && payload?.summary) {
                    setSummary(payload.summary as SessionSummary);
                    return;
                }

                if (type === "viewing_session.status.changed") {
                    setSession((current) => ({
                        ...current,
                        status: String(payload?.status || current.status),
                        startedAt: payload?.startedAt || current.startedAt,
                        endedAt: payload?.endedAt || current.endedAt,
                        id: payload?.sessionId || current.id,
                    }));
                }
            } catch (parseError) {
                console.error("Failed to parse viewing session SSE payload:", parseError);
            }
        };

        source.addEventListener("viewing_session", onRealtime);
        source.addEventListener("error", () => {
            setError("Realtime connection interrupted. Reconnecting…");
        });

        return () => {
            source.removeEventListener("viewing_session", onRealtime);
            source.close();
        };
    }, [activeSessionId]);

    const submitSessionStatus = (action: "start" | "pause" | "complete") => {
        startStatusTransition(async () => {
            setError(null);
            try {
                if (action === "start") {
                    const result = await startViewingSession(activeSessionId);
                    if (!result?.success) {
                        setError(result?.message || "Failed to start session.");
                        return;
                    }
                    setSession((current) => ({ ...current, status: "active", startedAt: current.startedAt || new Date().toISOString() }));
                    return;
                }

                if (action === "pause") {
                    const result = await pauseViewingSession(activeSessionId);
                    if (!result?.success) {
                        setError(result?.message || "Failed to pause session.");
                        return;
                    }
                    setSession((current) => ({ ...current, status: "paused" }));
                    return;
                }

                const result = await completeViewingSession(activeSessionId);
                if (!result?.success) {
                    setError(result?.message || "Failed to complete session.");
                    return;
                }
                setSession((current) => ({ ...current, status: "completed", endedAt: new Date().toISOString() }));
            } catch (statusError: any) {
                setError(statusError?.message || "Failed to update session status.");
            }
        });
    };

    const sendAgentMessage = async () => {
        const text = agentDraft.trim();
        if (!text || messagePending) return;
        setMessagePending(true);
        setError(null);
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(activeSessionId)}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    speaker: "agent",
                    originalText: text,
                    originalLanguage: session.agentLanguage || "en",
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setError(payload?.error || payload?.message || "Failed to send message.");
                return;
            }
            setAgentDraft("");
            if (payload?.sessionId && payload.sessionId !== activeSessionId) {
                setSession((current) => ({ ...current, id: payload.sessionId }));
            }
        } catch (sendError: any) {
            setError(sendError?.message || "Failed to send message.");
        } finally {
            setMessagePending(false);
        }
    };

    const updateInsightState = async (insightId: string, action: "pin" | "dismiss" | "resolve") => {
        setError(null);
        try {
            const response = await fetch(
                `/api/viewings/sessions/${encodeURIComponent(activeSessionId)}/insights/${encodeURIComponent(insightId)}/state`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action }),
                }
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setError(payload?.error || "Failed to update insight state.");
                return;
            }
            setInsights((current) =>
                current.map((item) =>
                    item.id === insightId ? { ...item, state: payload.insight.state, updatedAt: payload.insight.updatedAt } : item
                )
            );
        } catch (insightError: any) {
            setError(insightError?.message || "Failed to update insight state.");
        }
    };

    const refreshLiveConfig = async (patch?: Partial<{ audioPlaybackClientEnabled: boolean; audioPlaybackAgentEnabled: boolean }>) => {
        if (livePending) return;
        setLivePending(true);
        setError(null);
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(activeSessionId)}/live-auth`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mode: session.mode,
                    audioPlaybackClientEnabled: patch?.audioPlaybackClientEnabled ?? session.audioPlaybackClientEnabled,
                    audioPlaybackAgentEnabled: patch?.audioPlaybackAgentEnabled ?? session.audioPlaybackAgentEnabled,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setError(payload?.error || "Failed to load live config.");
                return;
            }

            if (payload?.session?.id) {
                setSession((current) => ({
                    ...current,
                    id: payload.session.id,
                    status: payload.session.status || current.status,
                    mode: payload.session.mode || current.mode,
                    liveModel: payload.session.model || current.liveModel,
                    chainIndex: payload.session.chainIndex || current.chainIndex,
                    startedAt: payload.session.startedAt || current.startedAt,
                    audioPlaybackClientEnabled: !!payload.session.audioPlaybackClientEnabled,
                    audioPlaybackAgentEnabled: !!payload.session.audioPlaybackAgentEnabled,
                }));
            }
            setLiveInfo(payload.liveAuth || null);
        } catch (liveError: any) {
            setError(liveError?.message || "Failed to load live config.");
        } finally {
            setLivePending(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                    <Link href="/admin/contacts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to Contacts
                    </Link>
                    <h1 className="text-xl font-semibold">Viewing Session Copilot</h1>
                    <p className="text-xs text-muted-foreground">
                        {session.viewing.property.title} • {session.clientName || session.viewing.contact.name || "Client"} • {formatSessionStatus(session.status)}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => submitSessionStatus("start")} disabled={statusPending}>
                        {statusPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                        Start
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => submitSessionStatus("pause")} disabled={statusPending}>
                        <Pause className="mr-1.5 h-3.5 w-3.5" />
                        Pause
                    </Button>
                    <Button type="button" variant="default" size="sm" onClick={() => submitSessionStatus("complete")} disabled={statusPending}>
                        <SquareCheckBig className="mr-1.5 h-3.5 w-3.5" />
                        Complete
                    </Button>
                </div>
            </div>

            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
                <Card className="min-h-[560px]">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Live Transcript</CardTitle>
                        <CardDescription>
                            Original + translated text updates stream automatically.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <ScrollArea className="h-[420px] rounded-md border p-3">
                            <div className="space-y-2.5">
                                {orderedMessages.length === 0 && (
                                    <div className="text-xs text-muted-foreground">No utterances yet.</div>
                                )}
                                {orderedMessages.map((message) => (
                                    <div
                                        key={message.id}
                                        className={cn(
                                            "rounded-md border px-2.5 py-2 text-xs",
                                            message.speaker === "client" && "border-blue-200 bg-blue-50/50",
                                            message.speaker === "agent" && "border-emerald-200 bg-emerald-50/50"
                                        )}
                                    >
                                        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                                            <span>{formatSpeakerLabel(message.speaker)}</span>
                                            <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                                        </div>
                                        <div className="text-foreground">{message.originalText}</div>
                                        {message.translatedText && message.translatedText !== message.originalText && (
                                            <div className="mt-1 text-muted-foreground">
                                                {message.translatedText}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>

                        <div className="space-y-2">
                            <Label htmlFor="agent-draft">Send agent note/utterance</Label>
                            <Textarea
                                id="agent-draft"
                                value={agentDraft}
                                onChange={(event) => setAgentDraft(event.target.value)}
                                placeholder="Type what the agent said or wants translated…"
                                rows={3}
                            />
                            <Button type="button" size="sm" onClick={sendAgentMessage} disabled={!agentDraft.trim() || messagePending}>
                                {messagePending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                                Send
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Live Controls</CardTitle>
                            <CardDescription>Playback toggles affect audio only. Text always stays visible.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                                <div className="space-y-0.5">
                                    <div className="text-sm font-medium">Client audio playback</div>
                                    <div className="text-[11px] text-muted-foreground">Speak responses out loud to the client</div>
                                </div>
                                <Switch
                                    checked={session.audioPlaybackClientEnabled}
                                    onCheckedChange={(checked) => {
                                        setSession((current) => ({ ...current, audioPlaybackClientEnabled: checked }));
                                        void refreshLiveConfig({ audioPlaybackClientEnabled: checked });
                                    }}
                                />
                            </div>
                            <div className="flex items-center justify-between gap-3 rounded-md border p-2.5">
                                <div className="space-y-0.5">
                                    <div className="text-sm font-medium">Agent audio playback</div>
                                    <div className="text-[11px] text-muted-foreground">Play suggested spoken replies to the agent</div>
                                </div>
                                <Switch
                                    checked={session.audioPlaybackAgentEnabled}
                                    onCheckedChange={(checked) => {
                                        setSession((current) => ({ ...current, audioPlaybackAgentEnabled: checked }));
                                        void refreshLiveConfig({ audioPlaybackAgentEnabled: checked });
                                    }}
                                />
                            </div>

                            <Button type="button" variant="outline" size="sm" onClick={() => refreshLiveConfig()} disabled={livePending} className="w-full">
                                {livePending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                                Refresh Live Config
                            </Button>

                            {liveInfo && (
                                <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                                    <div>Model: {liveInfo.model}</div>
                                    <div>Mode: {session.mode}</div>
                                    <div>Chain Index: {session.chainIndex}</div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Insights</CardTitle>
                            <CardDescription>Pin, dismiss, or resolve AI suggestions in real time.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ScrollArea className="h-[220px]">
                                <div className="space-y-2">
                                    {activeInsights.length === 0 && (
                                        <div className="text-xs text-muted-foreground">No active insights yet.</div>
                                    )}
                                    {activeInsights.map((insight) => (
                                        <div key={insight.id} className="rounded-md border p-2 text-xs">
                                            <div className="mb-1 flex items-center justify-between gap-2">
                                                <span className="font-medium">{insight.shortText}</span>
                                                <span className="text-[10px] uppercase text-muted-foreground">{insight.type.replace(/_/g, " ")}</span>
                                            </div>
                                            {insight.longText && <div className="text-muted-foreground">{insight.longText}</div>}
                                            <div className="mt-2 flex items-center gap-1">
                                                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => updateInsightState(insight.id, "pin")}>
                                                    Pin
                                                </Button>
                                                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => updateInsightState(insight.id, "resolve")}>
                                                    Resolve
                                                </Button>
                                                <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => updateInsightState(insight.id, "dismiss")}>
                                                    Dismiss
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Session Summary</CardTitle>
                            <CardDescription>Draft updates as analysis completes.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-xs">
                            {!summary?.sessionSummary && (
                                <div className="text-muted-foreground">
                                    Summary will appear after insights are generated or once session is completed.
                                </div>
                            )}
                            {summary?.sessionSummary && (
                                <div className="rounded-md border bg-muted/20 p-2.5">{summary.sessionSummary}</div>
                            )}

                            {Array.isArray(summary?.recommendedNextActions) && summary!.recommendedNextActions.length > 0 && (
                                <div className="rounded-md border p-2.5">
                                    <div className="mb-1 text-[11px] font-semibold">Recommended next actions</div>
                                    <div className="space-y-1 text-muted-foreground">
                                        {summary!.recommendedNextActions.map((item, idx) => (
                                            <div key={`${item}-${idx}`} className="flex items-start gap-1.5">
                                                <Sparkles className="mt-0.5 h-3 w-3 text-muted-foreground" />
                                                <span>{item}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
