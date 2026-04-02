"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    createSupersededMessageIdSet,
    selectEffectiveViewingTranscriptMessages,
    sortViewingTranscriptMessages,
} from "@/lib/viewings/sessions/transcript";
import { cn } from "@/lib/utils";

type SessionPreview = {
    id: string;
    clientName: string | null;
    mode: string;
    status: string;
    transportStatus: string;
    liveProvider: string | null;
    clientLanguage: string | null;
    agentLanguage: string | null;
    property: {
        title: string;
        reference: string | null;
    };
    agent: {
        name: string;
    };
};

type SessionMessage = {
    id: string;
    speaker: string;
    origin?: string | null;
    transcriptStatus?: string | null;
    translationStatus?: string | null;
    insightStatus?: string | null;
    supersedesMessageId?: string | null;
    originalText: string;
    translatedText: string | null;
    timestamp: string;
};

type Props = {
    token: string;
    preview: SessionPreview;
};

type SpeechRecognizerLike = {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((event: any) => void) | null;
    onerror: ((event: any) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
};

function createSpeechRecognizer(): SpeechRecognizerLike | null {
    if (typeof window === "undefined") return null;
    const SpeechCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechCtor) return null;
    return new SpeechCtor();
}

function formatSpeaker(speaker: string) {
    if (speaker === "client") return "You";
    if (speaker === "agent") return "Agent";
    return "Assistant";
}

export function ClientSessionView({ token, preview }: Props) {
    const [pin, setPin] = useState("");
    const [preferredLanguage, setPreferredLanguage] = useState(preview.clientLanguage || "en");
    const [aiDisclosureAccepted, setAiDisclosureAccepted] = useState(false);
    const [joinPending, setJoinPending] = useState(false);
    const [joinError, setJoinError] = useState<string | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<SessionMessage[]>([]);
    const [draft, setDraft] = useState("");
    const [draftOrigin, setDraftOrigin] = useState<"manual_text" | "browser_stt">("manual_text");
    const [sending, setSending] = useState(false);
    const [speechOn, setSpeechOn] = useState(false);
    const [audioPlaybackEnabled, setAudioPlaybackEnabled] = useState(false);
    const [liveModeLabel, setLiveModeLabel] = useState<string | null>(null);
    const [transportStatus, setTransportStatus] = useState<string>(preview.transportStatus || "disconnected");
    const [liveProvider, setLiveProvider] = useState<string | null>(preview.liveProvider || null);
    const [showTranscriptRevisions, setShowTranscriptRevisions] = useState(false);
    const recognizerRef = useRef<SpeechRecognizerLike | null>(null);

    const orderedMessages = useMemo(
        () => sortViewingTranscriptMessages(messages),
        [messages]
    );
    const supersededIds = useMemo(
        () => createSupersededMessageIdSet(orderedMessages),
        [orderedMessages]
    );
    const renderedMessages = useMemo(
        () => showTranscriptRevisions ? orderedMessages : selectEffectiveViewingTranscriptMessages(orderedMessages),
        [orderedMessages, showTranscriptRevisions]
    );
    const transportConnected = transportStatus === "connected";

    useEffect(() => {
        recognizerRef.current = createSpeechRecognizer();
        return () => {
            try {
                recognizerRef.current?.stop();
            } catch {
                // No-op
            }
        };
    }, []);

    useEffect(() => {
        if (!sessionId || !accessToken) return;
        const source = new EventSource(
            `/api/viewings/sessions/events?sessionId=${encodeURIComponent(sessionId)}&accessToken=${encodeURIComponent(accessToken)}`
        );

        const onRealtime = (event: MessageEvent) => {
            try {
                const envelope = JSON.parse(event.data || "{}");
                const type = String(envelope?.type || "");
                const payload = envelope?.payload || {};

                if (type === "viewing_session.message.created" && payload?.message) {
                    const incoming = payload.message as SessionMessage;
                    setMessages((current) => (current.some((item) => item.id === incoming.id) ? current : [...current, incoming]));
                    return;
                }
                if (type === "viewing_session.message.updated" && payload?.message?.id) {
                    const patch = payload.message as Partial<SessionMessage> & { id: string };
                    setMessages((current) => current.map((item) => (item.id === patch.id ? { ...item, ...patch } : item)));
                    return;
                }
                if (type === "viewing_session.status.changed" && payload?.sessionId) {
                    setSessionId(String(payload.sessionId));
                    setTransportStatus((current) => String(payload?.transportStatus || current));
                    return;
                }
                if (type === "viewing_session.transport.status.changed") {
                    setSessionId(String(payload?.sessionId || sessionId));
                    setTransportStatus((current) => String(payload?.transportStatus || current));
                }
            } catch (error) {
                console.error("Failed to parse client session SSE payload:", error);
            }
        };

        source.addEventListener("viewing_session", onRealtime);
        return () => {
            source.removeEventListener("viewing_session", onRealtime);
            source.close();
        };
    }, [sessionId, accessToken]);

    const joinSession = async () => {
        if (!pin.trim() || joinPending) return;
        setJoinPending(true);
        setJoinError(null);
        try {
            const response = await fetch("/api/viewings/sessions/join", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token,
                    pin: pin.trim(),
                    preferredLanguage: preferredLanguage || undefined,
                    aiDisclosureAccepted,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setJoinError(payload?.error || "Unable to join this session.");
                return;
            }
            setAccessToken(payload.accessToken);
            setSessionId(payload.sessionId);
            setPreferredLanguage(payload?.session?.clientLanguage || preferredLanguage);
            setLiveModeLabel(payload?.session?.mode || preview.mode);
            setTransportStatus(payload?.session?.transportStatus || transportStatus);
            setLiveProvider(payload?.session?.liveProvider || liveProvider);
        } catch (error: any) {
            setJoinError(error?.message || "Unable to join this session.");
        } finally {
            setJoinPending(false);
        }
    };

    const sendMessage = async (textOverride?: string) => {
        const text = (textOverride ?? draft).trim();
        if (!text || !sessionId || !accessToken || sending) return;
        setSending(true);
        setJoinError(null);
        try {
            const response = await fetch(
                `/api/viewings/sessions/${encodeURIComponent(sessionId)}/messages?accessToken=${encodeURIComponent(accessToken)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        speaker: "client",
                        origin: draftOrigin,
                        transcriptStatus: "final",
                        originalText: text,
                        originalLanguage: preferredLanguage || preview.clientLanguage || "auto",
                    }),
                }
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setJoinError(payload?.error || "Failed to send message.");
                return;
            }
            if (payload?.sessionId && payload.sessionId !== sessionId) {
                setSessionId(payload.sessionId);
            }
            if (payload?.sessionAccessToken) {
                setAccessToken(payload.sessionAccessToken);
            }
            setDraft("");
            setDraftOrigin("manual_text");
        } catch (error: any) {
            setJoinError(error?.message || "Failed to send message.");
        } finally {
            setSending(false);
        }
    };

    const toggleSpeech = () => {
        const recognizer = recognizerRef.current;
        if (!recognizer) {
            setJoinError("Speech recognition is not available in this browser.");
            return;
        }
        if (speechOn) {
            recognizer.stop();
            setSpeechOn(false);
            return;
        }

        recognizer.lang = preferredLanguage || "en";
        recognizer.interimResults = false;
        recognizer.continuous = true;
        recognizer.onresult = (event: any) => {
            const last = event?.results?.[event.results.length - 1];
            const transcript = String(last?.[0]?.transcript || "").trim();
            if (!transcript) return;
            setDraft((current) => (current ? `${current} ${transcript}` : transcript));
            setDraftOrigin("browser_stt");
        };
        recognizer.onerror = () => {
            setSpeechOn(false);
        };
        recognizer.onend = () => {
            setSpeechOn(false);
        };
        recognizer.start();
        setSpeechOn(true);
    };

    const syncAudioToggle = async (nextEnabled: boolean) => {
        setAudioPlaybackEnabled(nextEnabled);
        if (!sessionId || !accessToken) return;
        try {
            const response = await fetch(
                `/api/viewings/sessions/${encodeURIComponent(sessionId)}/live-auth?accessToken=${encodeURIComponent(accessToken)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        mode: preview.mode,
                        audioPlaybackClientEnabled: nextEnabled,
                    }),
                }
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setJoinError(payload?.error || "Failed to update audio setting.");
                return;
            }
            setLiveModeLabel(payload?.session?.mode || liveModeLabel);
            setTransportStatus(payload?.session?.transportStatus || transportStatus);
            setLiveProvider(payload?.session?.liveProvider || liveProvider);
            if (payload?.session?.id && payload.session.id !== sessionId) {
                setSessionId(payload.session.id);
            }
            if (payload?.sessionAccessToken) {
                setAccessToken(payload.sessionAccessToken);
            }
        } catch (error: any) {
            setJoinError(error?.message || "Failed to update audio setting.");
        }
    };

    return (
        <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6 sm:py-8">
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">{preview.property.title}</CardTitle>
                    <CardDescription>
                        Agent: {preview.agent.name} • {preview.property.reference ? `Ref ${preview.property.reference}` : "Live viewing session"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {!accessToken && (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="pin">Enter your PIN</Label>
                                <Input
                                    id="pin"
                                    inputMode="numeric"
                                    placeholder="6-digit PIN"
                                    value={pin}
                                    onChange={(event) => setPin(event.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="language">Language</Label>
                                <Input
                                    id="language"
                                    placeholder="e.g. en, el, ru"
                                    value={preferredLanguage}
                                    onChange={(event) => setPreferredLanguage(event.target.value)}
                                />
                            </div>
                            <div className="rounded-md border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                                AI copilot may assist during this viewing session by processing transcript and language translation.
                            </div>
                            <label className="flex items-start gap-2 text-xs text-foreground">
                                <input
                                    type="checkbox"
                                    checked={aiDisclosureAccepted}
                                    onChange={(event) => setAiDisclosureAccepted(event.target.checked)}
                                    className="mt-0.5"
                                />
                                <span>I understand and accept AI assistance for this session.</span>
                            </label>
                            <Button
                                type="button"
                                onClick={joinSession}
                                disabled={joinPending || !pin.trim() || !aiDisclosureAccepted}
                                className="w-full"
                            >
                                {joinPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                                Join Session
                            </Button>
                        </div>
                    )}

                    {accessToken && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between rounded-md border p-2.5">
                                <div className="space-y-0.5">
                                    <div className="text-sm font-medium">Speak out loud</div>
                                    <div className="text-[11px] text-muted-foreground">
                                        Toggle AI voice playback (text stays visible always)
                                    </div>
                                </div>
                                <Switch checked={audioPlaybackEnabled} onCheckedChange={syncAudioToggle} disabled={!transportConnected} />
                            </div>
                            {!transportConnected && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
                                    Audio playback becomes available once live transport is connected. Text chat remains active.
                                </div>
                            )}

                            <div className="rounded-md border p-2.5">
                                <div className="mb-2 flex items-center justify-between">
                                    <Label className="text-xs">Talk input</Label>
                                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={toggleSpeech}>
                                        {speechOn ? <MicOff className="mr-1.5 h-3.5 w-3.5" /> : <Mic className="mr-1.5 h-3.5 w-3.5" />}
                                        {speechOn ? "Stop" : "Press to talk"}
                                    </Button>
                                </div>
                                <Input
                                    placeholder="Say something or type here..."
                                    value={draft}
                                    onChange={(event) => {
                                        setDraft(event.target.value);
                                        setDraftOrigin("manual_text");
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            void sendMessage();
                                        }
                                    }}
                                />
                                <Button type="button" size="sm" className="mt-2 w-full" onClick={() => sendMessage()} disabled={!draft.trim() || sending}>
                                    {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                                    Send
                                </Button>
                            </div>
                        </div>
                    )}

                    {joinError && (
                        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {joinError}
                        </div>
                    )}

                    {liveModeLabel && (
                        <div className="text-[11px] text-muted-foreground">
                            Live mode: {liveModeLabel} • Transport: {transportStatus}{liveProvider ? ` • ${liveProvider}` : ""}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">Conversation</CardTitle>
                    <CardDescription>Your text and translated updates appear here.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center justify-end">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => setShowTranscriptRevisions((current) => !current)}
                        >
                            {showTranscriptRevisions ? "Hide revisions" : "Show revisions"}
                        </Button>
                    </div>
                    {renderedMessages.length === 0 && (
                        <div className="text-xs text-muted-foreground">No messages yet.</div>
                    )}
                    {renderedMessages.map((message) => (
                        <div
                            key={message.id}
                            className={cn(
                                "rounded-md border px-3 py-2 text-xs",
                                message.speaker === "client" && "border-blue-200 bg-blue-50/60",
                                message.supersedesMessageId && "border-dashed"
                            )}
                        >
                            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {formatSpeaker(message.speaker)}
                            </div>
                            <div>{message.originalText}</div>
                            {message.translatedText && message.translatedText !== message.originalText && (
                                <div className="mt-1 text-muted-foreground">{message.translatedText}</div>
                            )}
                            <div className="mt-1 text-[10px] text-muted-foreground">
                                {message.transcriptStatus || "final"} • {message.translationStatus || "pending"} • {message.insightStatus || "pending"}
                            </div>
                            {showTranscriptRevisions && supersededIds.has(message.id) && (
                                <div className="mt-1 text-[10px] text-amber-700">
                                    Superseded by a newer correction
                                </div>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
