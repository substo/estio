"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Loader2,
    Mic,
    MicOff,
    Radio,
    Save,
    Send,
    Share2,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    sortViewingTranscriptMessages,
    selectEffectiveViewingTranscriptMessages,
} from "@/lib/viewings/sessions/transcript";
import { cn } from "@/lib/utils";

type SessionMessage = {
    id: string;
    sessionId?: string;
    sequence?: number | null;
    utteranceId?: string | null;
    sourceMessageId?: string | null;
    messageKind?: string | null;
    origin?: string | null;
    provider?: string | null;
    model?: string | null;
    modelVersion?: string | null;
    transcriptStatus?: string | null;
    persistedAt?: string | null;
    supersedesMessageId?: string | null;
    speaker: string;
    originalText: string;
    originalLanguage: string | null;
    translatedText: string | null;
    targetLanguage: string | null;
    confidence: number | null;
    translationStatus?: string | null;
    insightStatus?: string | null;
    analysisStatus: string;
    timestamp: string;
    createdAt: string;
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
    source?: string | null;
    provider?: string | null;
    model?: string | null;
    modelVersion?: string | null;
    usedFallback?: boolean | null;
    generatedByUserId?: string | null;
};

type SessionState = {
    id: string;
    sessionThreadId: string;
    locationId: string;
    status: string;
    consentStatus: string;
    consentAcceptedAt: string | null;
    consentVersion: string | null;
    consentLocale: string | null;
    consentSource: string | null;
    transportStatus: string;
    liveProvider: string | null;
    sessionKind: string;
    participantMode: string;
    speechMode: string | null;
    savePolicy: string;
    entryPoint: string | null;
    quickStartSource: string | null;
    assignmentStatus: string;
    liveModel: string | null;
    translationModel: string | null;
    insightsModel: string | null;
    summaryModel: string | null;
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
    } | null;
    contact: {
        id: string;
        name: string | null;
    } | null;
    primaryProperty: {
        id: string;
        title: string;
        reference: string | null;
    } | null;
};

type ContextOptions = {
    contacts: Array<{ id: string; label: string }>;
    properties: Array<{ id: string; label: string }>;
    viewings: Array<{ id: string; label: string }>;
};

type Props = {
    initialSession: SessionState;
    initialMessages: SessionMessage[];
    initialSummary: SessionSummary | null;
    quickContextOptions: ContextOptions;
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

function formatSessionKindLabel(value: string) {
    if (value === "listen_only") return "Listen";
    if (value === "two_way_interpreter") return "Two-way";
    if (value === "quick_translate") return "Speak";
    return "Structured";
}

function getMessageSpeakerForSessionKind(sessionKind: string) {
    if (sessionKind === "listen_only") return "client";
    return "agent";
}

function floatTo16BitPCM(float32Array: Float32Array) {
    const buffer = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return buffer;
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, targetSampleRate: number) {
    if (targetSampleRate >= inputSampleRate) {
        return floatTo16BitPCM(buffer);
    }
    const ratio = inputSampleRate / targetSampleRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0;
        let count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
            accum += buffer[i];
            count += 1;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult += 1;
        offsetBuffer = nextOffsetBuffer;
    }
    return floatTo16BitPCM(result);
}

function int16ToBase64(buffer: Int16Array) {
    const bytes = new Uint8Array(buffer.buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

export function QuickFieldAssist({ initialSession, initialMessages, initialSummary, quickContextOptions }: Props) {
    const [session, setSession] = useState(initialSession);
    const [messages, setMessages] = useState<SessionMessage[]>(initialMessages);
    const [summary, setSummary] = useState<SessionSummary | null>(initialSummary);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [livePending, startLiveTransition] = useTransition();
    const [modePending, startModeTransition] = useTransition();
    const [savePending, startSaveTransition] = useTransition();
    const [sending, setSending] = useState(false);
    const [speechOn, setSpeechOn] = useState(false);
    const [micStreaming, setMicStreaming] = useState(false);
    const [audioPlaybackEnabled, setAudioPlaybackEnabled] = useState(initialSession.audioPlaybackAgentEnabled);
    const [shareInfo, setShareInfo] = useState<{ url: string | null; token: string; pinCode: string; expiresAt: string } | null>(null);
    const [contextDialogOpen, setContextDialogOpen] = useState(false);
    const [selectedContactId, setSelectedContactId] = useState(initialSession.contact?.id || "");
    const [selectedPropertyId, setSelectedPropertyId] = useState(initialSession.primaryProperty?.id || "");
    const [selectedViewingId, setSelectedViewingId] = useState(initialSession.viewing?.id || "");
    const [contextNotes, setContextNotes] = useState("");
    const recognizerRef = useRef<SpeechRecognizerLike | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const relaySocketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const liveInfoRef = useRef<any>(null);

    const renderedMessages = useMemo(
        () => selectEffectiveViewingTranscriptMessages(sortViewingTranscriptMessages(messages)),
        [messages]
    );
    const latestMessage = renderedMessages[renderedMessages.length - 1] || null;
    const sessionTitle = session.primaryProperty?.title || session.viewing?.property.title || "Quick Field Assist";
    const participantLabel = session.contact?.name || session.viewing?.contact.name || session.clientName || "Unassigned session";

    useEffect(() => {
        recognizerRef.current = createSpeechRecognizer();
        return () => {
            try {
                recognizerRef.current?.stop();
            } catch {
                // no-op
            }
        };
    }, []);

    useEffect(() => {
        const source = new EventSource(`/api/viewings/sessions/events?sessionId=${encodeURIComponent(session.id)}`);
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
                if (type === "viewing_session.summary.updated" && payload?.summary) {
                    setSummary(payload.summary as SessionSummary);
                    return;
                }
                if (type === "viewing_session.transport.status.changed") {
                    setSession((current) => ({
                        ...current,
                        transportStatus: String(payload?.transportStatus || current.transportStatus),
                    }));
                    return;
                }
                if (type === "viewing_session.status.changed") {
                    setSession((current) => ({
                        ...current,
                        status: String(payload?.status || current.status),
                        transportStatus: String(payload?.transportStatus || current.transportStatus),
                        endedAt: payload?.endedAt || current.endedAt,
                    }));
                    return;
                }
                if (type === "viewing_session.context.updated") {
                    setSession((current) => ({
                        ...current,
                        contact: payload?.contextSnapshot?.leadProfile
                            ? {
                                id: String(payload.contextSnapshot.leadProfile.id || current.contact?.id || ""),
                                name: String(
                                    payload.contextSnapshot.leadProfile.name
                                    || payload.contextSnapshot.leadProfile.firstName
                                    || current.contact?.name
                                    || "Contact"
                                ),
                            }
                            : current.contact,
                        primaryProperty: payload?.contextSnapshot?.primaryProperty
                            ? {
                                id: String(payload.contextSnapshot.primaryProperty.id || current.primaryProperty?.id || ""),
                                title: String(payload.contextSnapshot.primaryProperty.title || current.primaryProperty?.title || "Property"),
                                reference: payload.contextSnapshot.primaryProperty.reference
                                    ? String(payload.contextSnapshot.primaryProperty.reference)
                                    : null,
                            }
                            : current.primaryProperty,
                        assignmentStatus: String(payload?.assignmentStatus || current.assignmentStatus),
                    }));
                }
            } catch (parseError) {
                console.error("Failed to parse quick field assist SSE payload:", parseError);
            }
        };

        source.addEventListener("viewing_session", onRealtime);
        return () => {
            source.removeEventListener("viewing_session", onRealtime);
            source.close();
        };
    }, [session.id]);

    useEffect(() => {
        return () => {
            relaySocketRef.current?.close();
            mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
            audioProcessorRef.current?.disconnect();
            audioSourceRef.current?.disconnect();
            audioContextRef.current?.close().catch(() => undefined);
        };
    }, []);

    const connectLiveTransport = async () => {
        const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/live-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: "assistant_live_tool_heavy",
                audioPlaybackAgentEnabled: audioPlaybackEnabled,
            }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to initialize live transport.");
        }

        setSession((current) => ({
            ...current,
            transportStatus: payload?.session?.transportStatus || current.transportStatus,
            liveProvider: payload?.session?.liveProvider || current.liveProvider,
            participantMode: payload?.session?.participantMode || current.participantMode,
            sessionKind: payload?.session?.sessionKind || current.sessionKind,
            speechMode: payload?.session?.speechMode || current.speechMode,
            savePolicy: payload?.session?.savePolicy || current.savePolicy,
            audioPlaybackAgentEnabled: !!payload?.session?.audioPlaybackAgentEnabled,
        }));

        liveInfoRef.current = payload.liveAuth || null;
        const relayUrl = String(payload?.liveAuth?.relay?.websocketUrl || "").trim();
        const relaySessionToken = String(payload?.liveAuth?.relay?.relaySessionToken || "").trim();
        if (!relayUrl || !relaySessionToken) {
            return null;
        }

        const socketUrl = relayUrl.includes("?")
            ? `${relayUrl}&relaySessionToken=${encodeURIComponent(relaySessionToken)}`
            : `${relayUrl}?relaySessionToken=${encodeURIComponent(relaySessionToken)}`;
        relaySocketRef.current?.close();
        const socket = new WebSocket(socketUrl);
        await new Promise<void>((resolve, reject) => {
            const handleOpen = () => {
                cleanup();
                resolve();
            };
            const handleError = () => {
                cleanup();
                reject(new Error("Live relay connection failed."));
            };
            const cleanup = () => {
                socket.removeEventListener("open", handleOpen);
                socket.removeEventListener("error", handleError);
            };
            socket.addEventListener("open", handleOpen);
            socket.addEventListener("error", handleError);
        });
        socket.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || "{}");
                if (payload?.type === "relay.audio.chunk" && audioPlaybackEnabled && payload?.mimeType && payload?.data) {
                    const audio = new Audio(`data:${payload.mimeType};base64,${payload.data}`);
                    void audio.play().catch(() => undefined);
                }
                if (payload?.type === "relay.error") {
                    setError(String(payload?.error || "Relay transport error."));
                }
            } catch (relayError) {
                console.error("Failed to parse relay websocket payload:", relayError);
            }
        };
        socket.onclose = () => {
            relaySocketRef.current = null;
            setSession((current) => ({ ...current, transportStatus: "disconnected" }));
        };
        relaySocketRef.current = socket;
        return socket;
    };

    const startLiveMicStream = async () => {
        const socket = relaySocketRef.current && relaySocketRef.current.readyState === WebSocket.OPEN
            ? relaySocketRef.current
            : await connectLiveTransport();
        if (!socket) {
            throw new Error("Live relay is unavailable.");
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
            if (!relaySocketRef.current || relaySocketRef.current.readyState !== WebSocket.OPEN) return;
            const input = event.inputBuffer.getChannelData(0);
            const downsampled = downsampleBuffer(input, audioContext.sampleRate, 16000);
            relaySocketRef.current.send(JSON.stringify({
                eventType: "audio_input",
                mimeType: "audio/pcm;rate=16000",
                data: int16ToBase64(downsampled),
            }));
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
        mediaStreamRef.current = stream;
        audioContextRef.current = audioContext;
        audioSourceRef.current = source;
        audioProcessorRef.current = processor;
        setMicStreaming(true);
    };

    const stopLiveMicStream = () => {
        if (relaySocketRef.current?.readyState === WebSocket.OPEN) {
            relaySocketRef.current.send(JSON.stringify({
                eventType: "audio_input",
                mimeType: "audio/pcm;rate=16000",
                audioStreamEnd: true,
            }));
        }
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        audioProcessorRef.current?.disconnect();
        audioSourceRef.current?.disconnect();
        audioContextRef.current?.close().catch(() => undefined);
        audioProcessorRef.current = null;
        audioSourceRef.current = null;
        audioContextRef.current = null;
        setMicStreaming(false);
    };

    const sendMessage = async (textOverride?: string) => {
        const text = String(textOverride ?? draft).trim();
        if (!text || sending) return;
        const speaker = getMessageSpeakerForSessionKind(session.sessionKind);
        setSending(true);
        setError(null);
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    speaker,
                    originalText: text,
                    originalLanguage: speaker === "client"
                        ? (session.clientLanguage || session.agentLanguage || "en")
                        : (session.agentLanguage || "en"),
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setError(payload?.error || "Failed to send message.");
                return;
            }
            setDraft("");
        } catch (sendError: any) {
            setError(sendError?.message || "Failed to send message.");
        } finally {
            setSending(false);
        }
    };

    const transcribeRecordedAudio = async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/audio-transcribe`, {
            method: "POST",
            body: formData,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to transcribe audio.");
        }
        await sendMessage(payload.transcript);
    };

    const toggleFallbackRecorder = async () => {
        if (micStreaming) {
            stopLiveMicStream();
            return;
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
            return;
        }

        if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
            try {
                await startLiveMicStream();
                return;
            } catch {
                // fall through to clip recording / speech recognition fallback
            }
        }

        if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            const recognizer = recognizerRef.current;
            if (!recognizer) {
                setError("Microphone capture is not available in this browser.");
                return;
            }
            recognizer.lang = session.agentLanguage || "en";
            recognizer.interimResults = false;
            recognizer.continuous = true;
            recognizer.onresult = (event: any) => {
                const last = event?.results?.[event.results.length - 1];
                const transcript = String(last?.[0]?.transcript || "").trim();
                if (transcript) {
                    setDraft((current) => (current ? `${current} ${transcript}` : transcript));
                }
            };
            recognizer.onerror = () => setSpeechOn(false);
            recognizer.onend = () => setSpeechOn(false);
            if (speechOn) {
                recognizer.stop();
                setSpeechOn(false);
            } else {
                recognizer.start();
                setSpeechOn(true);
            }
            return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaStreamRef.current = stream;
        mediaRecorderRef.current = recorder;
        mediaChunksRef.current = [];

        recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data && event.data.size > 0) {
                mediaChunksRef.current.push(event.data);
            }
        };

        recorder.onstop = async () => {
            const chunks = [...mediaChunksRef.current];
            mediaChunksRef.current = [];
            stream.getTracks().forEach((track) => track.stop());
            mediaRecorderRef.current = null;
            const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            if (!blob.size) return;
            try {
                await transcribeRecordedAudio(new File([blob], `quick-assist-${Date.now()}.webm`, { type: blob.type }));
            } catch (transcribeError: any) {
                setError(transcribeError?.message || "Failed to process recorded audio.");
            }
        };

        recorder.start();
        setMicStreaming(true);
        setTimeout(() => {
            if (recorder.state === "recording") {
                recorder.stop();
                setMicStreaming(false);
            }
        }, 5000);
    };

    const applyContextUpdate = async () => {
        setError(null);
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/context`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contactId: selectedContactId || undefined,
                    primaryPropertyId: selectedPropertyId || undefined,
                    viewingId: selectedViewingId || undefined,
                    notes: contextNotes || undefined,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setError(payload?.error || "Failed to attach context.");
                return;
            }

            setSession((current) => ({
                ...current,
                contact: payload?.contextSnapshot?.leadProfile
                    ? {
                        id: String(payload.contextSnapshot.leadProfile.id || selectedContactId || current.contact?.id || ""),
                        name: String(
                            payload.contextSnapshot.leadProfile.name
                            || payload.contextSnapshot.leadProfile.firstName
                            || current.contact?.name
                            || "Contact"
                        ),
                    }
                    : current.contact,
                primaryProperty: payload?.contextSnapshot?.primaryProperty
                    ? {
                        id: String(payload.contextSnapshot.primaryProperty.id || selectedPropertyId || current.primaryProperty?.id || ""),
                        title: String(payload.contextSnapshot.primaryProperty.title || current.primaryProperty?.title || "Property"),
                        reference: payload.contextSnapshot.primaryProperty.reference
                            ? String(payload.contextSnapshot.primaryProperty.reference)
                            : null,
                    }
                    : current.primaryProperty,
                viewing: selectedViewingId ? { ...(current.viewing || { id: selectedViewingId, date: "", property: { id: "", title: "", reference: null }, contact: { id: "", name: null }, user: { id: "", name: null } }), id: selectedViewingId } : current.viewing,
                assignmentStatus: payload?.session?.assignmentStatus || current.assignmentStatus,
            }));
            setContextDialogOpen(false);
        } catch (contextError: any) {
            setError(contextError?.message || "Failed to attach context.");
        }
    };

    const switchMode = (sessionKind: "quick_translate" | "listen_only") => {
        startModeTransition(async () => {
            setError(null);
            try {
                const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/convert`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionKind,
                        speechMode: sessionKind === "listen_only" ? "listen_only" : "push_to_talk",
                    }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.success) {
                    setError(payload?.error || "Failed to update quick mode.");
                    return;
                }
                setSession((current) => ({
                    ...current,
                    sessionKind: payload?.session?.sessionKind || sessionKind,
                    speechMode: payload?.session?.speechMode || current.speechMode,
                }));
            } catch (modeError: any) {
                setError(modeError?.message || "Failed to update quick mode.");
            }
        });
    };

    const enableShareMode = () => {
        startModeTransition(async () => {
            setError(null);
            try {
                const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/convert`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        participantMode: "shared_client",
                    }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.success) {
                    setError(payload?.error || "Failed to enable share mode.");
                    return;
                }
                setSession((current) => ({
                    ...current,
                    participantMode: payload?.session?.participantMode || "shared_client",
                }));
                setShareInfo(payload?.join || null);
            } catch (shareError: any) {
                setError(shareError?.message || "Failed to enable share mode.");
            }
        });
    };

    const closeSession = (savePolicy: "save_transcript" | "save_summary_only" | "discard_on_close") => {
        startSaveTransition(async () => {
            setError(null);
            try {
                const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/close`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        savePolicy,
                        attachToContactId: selectedContactId || undefined,
                        attachToPropertyId: selectedPropertyId || undefined,
                        viewingId: selectedViewingId || undefined,
                    }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.success) {
                    setError(payload?.error || "Failed to close session.");
                    return;
                }
                setSession((current) => ({
                    ...current,
                    status: payload?.session?.status || "completed",
                    endedAt: payload?.session?.endedAt || new Date().toISOString(),
                    savePolicy,
                }));
            } catch (closeError: any) {
                setError(closeError?.message || "Failed to close session.");
            }
        });
    };

    return (
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                    <Link href="/admin/contacts" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to Contacts
                    </Link>
                    <h1 className="text-2xl font-semibold tracking-tight">{sessionTitle}</h1>
                    <p className="text-sm text-muted-foreground">
                        {participantLabel} • {formatSessionKindLabel(session.sessionKind)} • {session.participantMode === "agent_only" ? "Private" : "Shared"}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <Badge variant="secondary">{session.assignmentStatus === "assigned" ? "Assigned" : "Needs assignment"}</Badge>
                        <Badge variant="outline">Transport {session.transportStatus}</Badge>
                        <Badge variant="outline">Save {session.savePolicy}</Badge>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => startLiveTransition(async () => {
                            setError(null);
                            try {
                                await connectLiveTransport();
                            } catch (liveError: any) {
                                setError(liveError?.message || "Failed to connect live transport.");
                            }
                        })}
                        disabled={livePending}
                    >
                        {livePending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Radio className="mr-1.5 h-4 w-4" />}
                        Connect Live
                    </Button>
                    <Button type="button" onClick={enableShareMode} disabled={modePending || session.participantMode === "shared_client"}>
                        <Share2 className="mr-1.5 h-4 w-4" />
                        Share
                    </Button>
                </div>
            </div>

            {session.participantMode === "agent_only" && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Internal quick mode is active. Client disclosure is only required after you switch to shared mode.
                </div>
            )}

            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {error}
                </div>
            )}

            {shareInfo && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Share Link Ready</CardTitle>
                        <CardDescription>Use this if you want the client to join the shared session.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="text-xs text-muted-foreground">{shareInfo.url || "Link available in this browser session only."}</div>
                        <div className="text-sm">PIN: <span className="font-semibold">{shareInfo.pinCode}</span></div>
                    </CardContent>
                </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
                <Card className="overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Live Translation</CardTitle>
                        <CardDescription>Translated text is emphasized for fast field reading.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant={session.sessionKind === "quick_translate" ? "default" : "outline"}
                                onClick={() => switchMode("quick_translate")}
                                disabled={modePending}
                            >
                                Speak
                            </Button>
                            <Button
                                type="button"
                                variant={session.sessionKind === "listen_only" ? "default" : "outline"}
                                onClick={() => switchMode("listen_only")}
                                disabled={modePending}
                            >
                                Listen
                            </Button>
                            <Dialog open={contextDialogOpen} onOpenChange={setContextDialogOpen}>
                                <DialogTrigger asChild>
                                    <Button type="button" variant="outline">Attach Context</Button>
                                </DialogTrigger>
                                <DialogContent>
                                    <DialogHeader>
                                        <DialogTitle>Attach Session Context</DialogTitle>
                                        <DialogDescription>Add contact, property, or viewing context without restarting the session.</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-3">
                                        <div className="space-y-1.5">
                                            <Label>Contact</Label>
                                            <Select value={selectedContactId || "__none"} onValueChange={(value) => setSelectedContactId(value === "__none" ? "" : value)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select contact" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none">No contact</SelectItem>
                                                    {quickContextOptions.contacts.map((contact) => (
                                                        <SelectItem key={contact.id} value={contact.id}>{contact.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Property</Label>
                                            <Select value={selectedPropertyId || "__none"} onValueChange={(value) => setSelectedPropertyId(value === "__none" ? "" : value)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select property" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none">No property</SelectItem>
                                                    {quickContextOptions.properties.map((property) => (
                                                        <SelectItem key={property.id} value={property.id}>{property.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Viewing</Label>
                                            <Select value={selectedViewingId || "__none"} onValueChange={(value) => setSelectedViewingId(value === "__none" ? "" : value)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select viewing" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none">No viewing</SelectItem>
                                                    {quickContextOptions.viewings.map((viewing) => (
                                                        <SelectItem key={viewing.id} value={viewing.id}>{viewing.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Notes</Label>
                                            <Textarea value={contextNotes} onChange={(event) => setContextNotes(event.target.value)} placeholder="Optional session notes" />
                                        </div>
                                        <Button type="button" onClick={applyContextUpdate} className="w-full">
                                            Save Context
                                        </Button>
                                    </div>
                                </DialogContent>
                            </Dialog>
                        </div>

                        <ScrollArea className="h-[480px] rounded-xl border bg-slate-50 px-4 py-3">
                            <div className="space-y-3">
                                {renderedMessages.length === 0 && (
                                    <div className="rounded-xl border border-dashed bg-white px-4 py-8 text-center text-sm text-muted-foreground">
                                        Start speaking, listening, or typing to begin the session.
                                    </div>
                                )}
                                {renderedMessages.map((message, index) => {
                                    const translated = message.translatedText && message.translatedText !== message.originalText
                                        ? message.translatedText
                                        : message.originalText;
                                    return (
                                        <div
                                            key={message.id}
                                            className={cn(
                                                "rounded-2xl border bg-white px-4 py-3 shadow-sm",
                                                index === renderedMessages.length - 1 && "border-blue-300"
                                            )}
                                        >
                                            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                                                <span>{message.speaker}</span>
                                                <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                                            </div>
                                            <div className="text-lg font-medium leading-snug text-slate-950">{translated}</div>
                                            <div className="mt-1 text-sm text-slate-500">{message.originalText}</div>
                                            <div className="mt-2 text-[10px] text-muted-foreground">
                                                {message.translationStatus || "pending"} • {message.transcriptStatus || "final"}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>

                        <div className="rounded-2xl border bg-white p-3">
                            <div className="mb-2 flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-medium">Capture</div>
                                    <div className="text-[11px] text-muted-foreground">
                                        Live audio relay first, recorded-audio transcription fallback, browser speech fallback last.
                                    </div>
                                </div>
                                <Switch checked={audioPlaybackEnabled} onCheckedChange={setAudioPlaybackEnabled} />
                            </div>
                            <div className="flex gap-2">
                                <Button type="button" size="lg" className="flex-1" onClick={toggleFallbackRecorder}>
                                    {(micStreaming || speechOn) ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                                    {(micStreaming || speechOn) ? "Stop Mic" : "Start Mic"}
                                </Button>
                                <Input
                                    placeholder="Type a translated note or utterance"
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                            event.preventDefault();
                                            void sendMessage();
                                        }
                                    }}
                                />
                                <Button type="button" onClick={() => sendMessage()} disabled={!draft.trim() || sending}>
                                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Current Context</CardTitle>
                            <CardDescription>Attach structure after the session starts.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <div><span className="font-medium">Contact:</span> {session.contact?.name || "Not attached"}</div>
                            <div><span className="font-medium">Property:</span> {session.primaryProperty?.title || "Not attached"}</div>
                            <div><span className="font-medium">Viewing:</span> {session.viewing?.id || "Not attached"}</div>
                            <div><span className="font-medium">Languages:</span> {session.agentLanguage || "en"} {"->"} {session.clientLanguage || "en"}</div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Save Options</CardTitle>
                            <CardDescription>Close now and decide how much of the session to retain.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Button type="button" variant="default" className="w-full justify-start" onClick={() => closeSession("save_transcript")} disabled={savePending}>
                                <Save className="mr-2 h-4 w-4" />
                                Save Transcript
                            </Button>
                            <Button type="button" variant="outline" className="w-full justify-start" onClick={() => closeSession("save_summary_only")} disabled={savePending}>
                                <Save className="mr-2 h-4 w-4" />
                                Save Summary Only
                            </Button>
                            <Button type="button" variant="outline" className="w-full justify-start text-red-600" onClick={() => closeSession("discard_on_close")} disabled={savePending}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Discard On Close
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Summary</CardTitle>
                            <CardDescription>Generated after save or when manually refreshed by the server pipeline.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            {summary?.sessionSummary ? (
                                <>
                                    <div className="font-medium">{summary.sessionSummary}</div>
                                    {summary.recommendedNextActions?.length > 0 && (
                                        <ul className="list-disc pl-4 text-muted-foreground">
                                            {summary.recommendedNextActions.slice(0, 3).map((item) => (
                                                <li key={item}>{item}</li>
                                            ))}
                                        </ul>
                                    )}
                                </>
                            ) : (
                                <div className="text-muted-foreground">No saved summary yet.</div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">Latest Utterance</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1 text-sm">
                            <div className="font-medium">{latestMessage?.translatedText || latestMessage?.originalText || "No utterances yet."}</div>
                            {latestMessage && (
                                <div className="text-muted-foreground">{latestMessage.originalText}</div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
