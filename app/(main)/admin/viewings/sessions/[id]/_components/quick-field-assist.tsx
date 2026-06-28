"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    Check,
    ChevronsUpDown,
    Languages,
    Loader2,
    Mic,
    MicOff,
    Radio,
    Save,
    Send,
    Settings2,
    Share2,
    Shuffle,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { REPLY_LANGUAGE_OPTIONS, getReplyLanguageLabel, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
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
        contact: { id: string; name: string | null; preferredLang?: string | null };
        user: { id: string; name: string | null };
    } | null;
    contact: {
        id: string;
        name: string | null;
        preferredLang?: string | null;
    } | null;
    primaryProperty: {
        id: string;
        title: string;
        reference: string | null;
    } | null;
};

type ContextOptions = {
    contacts: Array<{ id: string; label: string; preferredLang?: string | null }>;
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

function getLiveModeForSessionKind(sessionKind: string) {
    if (sessionKind === "two_way_interpreter") return "assistant_live_translate";
    return "assistant_live_tool_heavy";
}

const EXTRA_LANGUAGE_OPTIONS = [
    { value: "nl", label: "Dutch (nl)" },
    { value: "sv", label: "Swedish (sv)" },
    { value: "fi", label: "Finnish (fi)" },
    { value: "da", label: "Danish (da)" },
    { value: "no", label: "Norwegian (no)" },
    { value: "cs", label: "Czech (cs)" },
    { value: "sk", label: "Slovak (sk)" },
    { value: "sr", label: "Serbian (sr)" },
    { value: "hr", label: "Croatian (hr)" },
    { value: "hi", label: "Hindi (hi)" },
    { value: "ur", label: "Urdu (ur)" },
    { value: "fa", label: "Persian (fa)" },
];

const LANGUAGE_OPTIONS = [...REPLY_LANGUAGE_OPTIONS, ...EXTRA_LANGUAGE_OPTIONS];

function languageLabel(value: string | null | undefined) {
    const normalized = normalizeReplyLanguage(value) || "en";
    const fromKnown = getReplyLanguageLabel(normalized);
    if (fromKnown) return fromKnown.replace(/\s*\([^)]+\)\s*$/, "");
    const option = LANGUAGE_OPTIONS.find((item) => item.value.toLowerCase() === normalized.toLowerCase());
    return (option?.label || normalized).replace(/\s*\([^)]+\)\s*$/, "");
}

function languageCode(value: string | null | undefined) {
    return normalizeReplyLanguage(value) || "en";
}

function isPendingTranslationStatus(value: string | null | undefined) {
    return !value || value === "pending" || value === "processing";
}

function resolveMessageTargetLanguage(message: SessionMessage, agentLanguage: string, clientLanguage: string) {
    if (message.targetLanguage) return languageCode(message.targetLanguage);
    if (message.speaker === "agent") return languageCode(clientLanguage);
    if (message.speaker === "customer") return languageCode(agentLanguage);
    return languageCode(clientLanguage || agentLanguage);
}

function getMessageDisplayState(message: SessionMessage, agentLanguage: string, clientLanguage: string) {
    const targetLanguage = resolveMessageTargetLanguage(message, agentLanguage, clientLanguage);
    const translatedText = message.translatedText?.trim() || "";
    const originalText = message.originalText.trim();
    const hasTranslatedText = !!translatedText && translatedText !== originalText;
    const sourceLanguage = message.originalLanguage ? languageCode(message.originalLanguage) : null;
    const isDifferentLanguage = !sourceLanguage || sourceLanguage !== targetLanguage;
    const isWaitingForTranslation = !hasTranslatedText && isDifferentLanguage && isPendingTranslationStatus(message.translationStatus);

    return {
        primaryText: hasTranslatedText
            ? translatedText
            : isWaitingForTranslation
                ? `Translating to ${languageLabel(targetLanguage)}...`
                : message.originalText,
        isWaitingForTranslation,
    };
}

function LanguagePicker({
    value,
    onChange,
    label,
    hint,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    hint?: string | null;
}) {
    const [open, setOpen] = useState(false);
    const resolved = languageCode(value);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    role="combobox"
                    aria-expanded={open}
                    className="h-auto min-h-[64px] w-full justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                >
                    <span className="min-w-0">
                        <span className="block text-[11px] font-medium uppercase text-muted-foreground">{label}</span>
                        <span className="block truncate text-base font-semibold text-slate-950">{languageLabel(resolved)}</span>
                        {hint && <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(340px,calc(100vw-32px))] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search languages..." />
                    <CommandList className="max-h-[320px]">
                        <CommandEmpty>No language found.</CommandEmpty>
                        <CommandGroup>
                            {LANGUAGE_OPTIONS.map((option) => {
                                const optionValue = languageCode(option.value);
                                const selected = optionValue === resolved;
                                return (
                                    <CommandItem
                                        key={option.value}
                                        value={`${option.label} ${option.value}`}
                                        onSelect={() => {
                                            onChange(optionValue);
                                            setOpen(false);
                                        }}
                                        className="cursor-pointer"
                                    >
                                        <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                                        <span>{languageLabel(optionValue)}</span>
                                        <span className="ml-auto text-xs text-muted-foreground">{optionValue}</span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
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

function base64ToUint8Array(value: string) {
    const binary = window.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function audioSampleRateFromMimeType(mimeType: string, fallback = 24000) {
    const match = mimeType.match(/rate=(\d+)/i);
    const parsed = match ? Number(match[1]) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pcm16ToFloat32(bytes: Uint8Array) {
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
        samples[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    return samples;
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
    const [audioPlaybackEnabled, setAudioPlaybackEnabled] = useState(
        initialSession.sessionKind === "two_way_interpreter" ? true : initialSession.audioPlaybackAgentEnabled
    );
    const [shareInfo, setShareInfo] = useState<{ url: string | null; token: string; pinCode: string; expiresAt: string } | null>(null);
    const [contextDialogOpen, setContextDialogOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [selectedContactId, setSelectedContactId] = useState(initialSession.contact?.id || "");
    const [selectedPropertyId, setSelectedPropertyId] = useState(initialSession.primaryProperty?.id || "");
    const [selectedViewingId, setSelectedViewingId] = useState(initialSession.viewing?.id || "");
    const [agentLanguage, setAgentLanguage] = useState(languageCode(initialSession.agentLanguage || "en"));
    const [clientLanguage, setClientLanguage] = useState(languageCode(initialSession.clientLanguage || initialSession.contact?.preferredLang || "en"));
    const [contextNotes, setContextNotes] = useState("");
    const recognizerRef = useRef<SpeechRecognizerLike | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const relaySocketRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const playbackAudioContextRef = useRef<AudioContext | null>(null);
    const playbackCursorRef = useRef(0);
    const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const liveInfoRef = useRef<any>(null);
    const audioPlaybackEnabledRef = useRef(audioPlaybackEnabled);

    const renderedMessages = useMemo(
        () => selectEffectiveViewingTranscriptMessages(sortViewingTranscriptMessages(messages)),
        [messages]
    );
    const latestMessage = renderedMessages[renderedMessages.length - 1] || null;
    const sessionTitle = session.primaryProperty?.title || session.viewing?.property.title || "Quick Field Assist";
    const participantLabel = session.contact?.name || session.viewing?.contact.name || session.clientName || "Unassigned session";
    const isInterpreterMode = session.sessionKind === "two_way_interpreter";
    const isListenOnlyMode = session.sessionKind === "listen_only" || session.speechMode === "listen_only" || session.participantMode === "agent_only";
    const selectedContact = quickContextOptions.contacts.find((contact) => contact.id === selectedContactId) || null;
    const contactLanguageHint = selectedContact?.preferredLang && languageCode(selectedContact.preferredLang) === languageCode(clientLanguage)
        ? `${languageLabel(selectedContact.preferredLang)} from contact`
        : null;
    const sameInterpreterLanguage = isInterpreterMode
        && languageCode(agentLanguage) === languageCode(clientLanguage);

    const stopPlaybackAudio = () => {
        playbackSourcesRef.current.forEach((source) => {
            try {
                source.stop();
            } catch {
                // no-op
            }
        });
        playbackSourcesRef.current.clear();
        playbackCursorRef.current = 0;
    };

    const playPcmAudioChunk = async (mimeType: string, data: string) => {
        if (!audioPlaybackEnabledRef.current) return;
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) return;

        const sampleRate = audioSampleRateFromMimeType(mimeType);
        const bytes = base64ToUint8Array(data);
        const samples = pcm16ToFloat32(bytes);
        if (samples.length === 0) return;

        const audioContext = playbackAudioContextRef.current || new AudioContextCtor();
        playbackAudioContextRef.current = audioContext;
        if (audioContext.state === "suspended") {
            await audioContext.resume().catch(() => undefined);
        }

        const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.onended = () => {
            playbackSourcesRef.current.delete(source);
        };

        const startAt = Math.max(audioContext.currentTime + 0.02, playbackCursorRef.current || 0);
        playbackCursorRef.current = startAt + buffer.duration;
        playbackSourcesRef.current.add(source);
        source.start(startAt);
    };

    useEffect(() => {
        audioPlaybackEnabledRef.current = audioPlaybackEnabled;
        if (!audioPlaybackEnabled) {
            stopPlaybackAudio();
        }
    }, [audioPlaybackEnabled]);

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
            stopPlaybackAudio();
            playbackAudioContextRef.current?.close().catch(() => undefined);
            playbackAudioContextRef.current = null;
        };
    }, []);

    const connectLiveTransport = async () => {
        const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/live-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                mode: getLiveModeForSessionKind(session.sessionKind),
                audioPlaybackAgentEnabled: isInterpreterMode ? true : audioPlaybackEnabled,
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
                if (payload?.type === "relay.audio.chunk" && audioPlaybackEnabledRef.current && payload?.mimeType && payload?.data) {
                    void playPcmAudioChunk(String(payload.mimeType), String(payload.data)).catch(() => undefined);
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

    const startInterpreterNow = () => {
        startLiveTransition(async () => {
            setError(null);
            setAudioPlaybackEnabled(true);
            audioPlaybackEnabledRef.current = true;
            try {
                await toggleFallbackRecorder();
            } catch (liveError: any) {
                setError(liveError?.message || "Failed to start live interpreter.");
            }
        });
    };

    const persistLanguagePair = async (nextAgentLanguage: string, nextClientLanguage: string) => {
        const normalizedAgent = languageCode(nextAgentLanguage);
        const normalizedClient = languageCode(nextClientLanguage);
        setAgentLanguage(normalizedAgent);
        setClientLanguage(normalizedClient);
        setError(null);

        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/context`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentLanguage: normalizedAgent,
                    clientLanguage: normalizedClient,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                setError(payload?.error || "Failed to update languages.");
                return;
            }
            setSession((current) => ({
                ...current,
                agentLanguage: payload?.session?.agentLanguage || normalizedAgent,
                clientLanguage: payload?.session?.clientLanguage || normalizedClient,
            }));
        } catch (languageError: any) {
            setError(languageError?.message || "Failed to update languages.");
        }
    };

    const selectContactForContext = (value: string) => {
        const contactId = value === "__none" ? "" : value;
        setSelectedContactId(contactId);
        const contact = quickContextOptions.contacts.find((item) => item.id === contactId);
        const preferredLanguage = languageCode(contact?.preferredLang || "");
        if (contact?.preferredLang && preferredLanguage !== languageCode(clientLanguage)) {
            void persistLanguagePair(agentLanguage, preferredLanguage);
        }
    };

    const swapLanguages = () => {
        void persistLanguagePair(clientLanguage, agentLanguage);
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
                    agentLanguage: agentLanguage || undefined,
                    clientLanguage: clientLanguage || undefined,
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
                        preferredLang: selectedContact?.preferredLang || current.contact?.preferredLang || null,
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
                agentLanguage: payload?.session?.agentLanguage || agentLanguage || current.agentLanguage,
                clientLanguage: payload?.session?.clientLanguage || clientLanguage || current.clientLanguage,
                assignmentStatus: payload?.session?.assignmentStatus || current.assignmentStatus,
            }));
            setContextDialogOpen(false);
        } catch (contextError: any) {
            setError(contextError?.message || "Failed to attach context.");
        }
    };

    const switchMode = (sessionKind: "quick_translate" | "listen_only" | "two_way_interpreter") => {
        startModeTransition(async () => {
            setError(null);
            try {
                const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/convert`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sessionKind,
                        speechMode: sessionKind === "listen_only"
                            ? "listen_only"
                            : sessionKind === "two_way_interpreter"
                                ? "continuous"
                                : "push_to_talk",
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
                    audioPlaybackAgentEnabled: sessionKind === "two_way_interpreter"
                        ? true
                        : current.audioPlaybackAgentEnabled,
                }));
                if (sessionKind === "two_way_interpreter") {
                    setAudioPlaybackEnabled(true);
                }
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
                        variant={isInterpreterMode ? "default" : "outline"}
                        onClick={() => startLiveTransition(async () => {
                            setError(null);
                            try {
                                if (isInterpreterMode) {
                                    await toggleFallbackRecorder();
                                } else {
                                    await connectLiveTransport();
                                }
                            } catch (liveError: any) {
                                setError(liveError?.message || (isInterpreterMode ? "Failed to start live interpreter." : "Failed to connect live transport."));
                            }
                        })}
                        disabled={livePending || (isInterpreterMode && micStreaming)}
                    >
                        {livePending
                            ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            : isInterpreterMode
                                ? <Mic className="mr-1.5 h-4 w-4" />
                                : <Radio className="mr-1.5 h-4 w-4" />}
                        {isInterpreterMode ? (micStreaming ? "Interpreter On" : "Start Interpreter") : "Connect Live"}
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

            {sameInterpreterLanguage && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Interpreter is set to {languageLabel(agentLanguage)} to {languageLabel(clientLanguage)}. Choose the customer language before starting if you need translated speech.
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

            <div className="space-y-4">
                <Card className="overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Live Interpreter</CardTitle>
                        <CardDescription>
                            {isListenOnlyMode
                                ? (session.transportStatus === "connected" ? `Translating your speech to ${languageLabel(clientLanguage)}.` : "Choose languages, then start the mic.")
                                : isInterpreterMode
                                ? (session.transportStatus === "connected" ? "Speak either language." : "Choose two languages, then start the mic.")
                                : (session.transportStatus === "connected" ? "Connected" : "Choose languages, then start speaking.")}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="rounded-xl border bg-white p-2">
                            <div className="grid grid-cols-[1fr,44px,1fr] items-center gap-1">
                                <LanguagePicker
                                    label="You speak"
                                    value={agentLanguage}
                                    onChange={(value) => void persistLanguagePair(value, clientLanguage)}
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="mx-auto h-10 w-10 rounded-full"
                                    onClick={swapLanguages}
                                    aria-label="Swap languages"
                                >
                                    <Shuffle className="h-4 w-4" />
                                </Button>
                                <LanguagePicker
                                    label="Customer"
                                    value={clientLanguage}
                                    hint={contactLanguageHint}
                                    onChange={(value) => void persistLanguagePair(agentLanguage, value)}
                                />
                            </div>
                            {sameInterpreterLanguage && (
                                <div className="px-3 pb-2 text-xs text-amber-700">
                                    Both sides are set to {languageLabel(clientLanguage)}.
                                </div>
                            )}
                        </div>

                        {!isInterpreterMode && (
                            <div className="rounded-xl border bg-white p-3">
                                <Textarea
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    placeholder="Type to translate, or use the mic."
                                    className="min-h-[96px] resize-none border-0 p-0 text-base shadow-none focus-visible:ring-0"
                                    onKeyDown={(event) => {
                                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                            event.preventDefault();
                                            void sendMessage();
                                        }
                                    }}
                                />
                            </div>
                        )}

                        <ScrollArea className="h-[360px] rounded-xl border bg-slate-50 px-4 py-3">
                            <div className="space-y-3">
                                {renderedMessages.length === 0 && (
                                    <div className="rounded-xl border border-dashed bg-white px-4 py-8 text-center text-sm text-muted-foreground">
                                        {isListenOnlyMode
                                            ? `Start the mic and speak ${languageLabel(agentLanguage)}.`
                                            : isInterpreterMode
                                            ? "Start the mic and speak either selected language."
                                            : "Start speaking, listening, or typing to begin the session."}
                                    </div>
                                )}
                                {renderedMessages.map((message, index) => {
                                    const display = getMessageDisplayState(message, agentLanguage, clientLanguage);
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
                                            <div
                                                className={cn(
                                                    "text-lg font-medium leading-snug",
                                                    display.isWaitingForTranslation ? "text-slate-500" : "text-slate-950"
                                                )}
                                            >
                                                {display.primaryText}
                                            </div>
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
                            <div className="flex flex-col gap-2 sm:flex-row">
                                <Button type="button" size="lg" className="min-h-12 flex-1" onClick={isInterpreterMode ? startInterpreterNow : toggleFallbackRecorder}>
                                    {(micStreaming || speechOn) ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                                    {(micStreaming || speechOn) ? "Stop Mic" : isInterpreterMode ? "Start Interpreter" : "Start Mic"}
                                </Button>
                                {!isInterpreterMode && (
                                    <Button type="button" size="lg" variant="outline" className="min-h-12 sm:w-32" onClick={() => sendMessage()} disabled={!draft.trim() || sending}>
                                        {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                        Send
                                    </Button>
                                )}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span>{isListenOnlyMode ? `Translates ${languageLabel(agentLanguage)} to ${languageLabel(clientLanguage)}.` : isInterpreterMode ? "Translates both directions from one mic." : "Live audio relay first, browser fallback last."}</span>
                                <label className="flex items-center gap-2">
                                    Speak
                                    <Switch checked={audioPlaybackEnabled} onCheckedChange={setAudioPlaybackEnabled} />
                                </label>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                        <Button type="button" variant="outline" className="w-full justify-center">
                            <Settings2 className="mr-2 h-4 w-4" />
                            {advancedOpen ? "Hide Advanced" : "Advanced"}
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4 space-y-4">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Mode & Context</CardTitle>
                                <CardDescription>Use this when you need more than fast two-way interpreting.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    <Button type="button" variant={session.sessionKind === "quick_translate" ? "default" : "outline"} onClick={() => switchMode("quick_translate")} disabled={modePending}>
                                        Speak
                                    </Button>
                                    <Button type="button" variant={session.sessionKind === "listen_only" ? "default" : "outline"} onClick={() => switchMode("listen_only")} disabled={modePending}>
                                        Listen
                                    </Button>
                                    <Button type="button" variant={session.sessionKind === "two_way_interpreter" ? "default" : "outline"} onClick={() => switchMode("two_way_interpreter")} disabled={modePending}>
                                        <Languages className="mr-1.5 h-4 w-4" />
                                        Interpreter
                                    </Button>
                                </div>
                                <Dialog open={contextDialogOpen} onOpenChange={setContextDialogOpen}>
                                    <DialogTrigger asChild>
                                        <Button type="button" variant="outline" className="w-full justify-start">Attach Context</Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Attach Session Context</DialogTitle>
                                            <DialogDescription>Add contact, property, or viewing context without restarting the session.</DialogDescription>
                                        </DialogHeader>
                                        <div className="space-y-3">
                                            <div className="space-y-1.5">
                                                <Label>Contact</Label>
                                                <Select value={selectedContactId || "__none"} onValueChange={selectContactForContext}>
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
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <LanguagePicker label="Agent language" value={agentLanguage} onChange={(value) => void persistLanguagePair(value, clientLanguage)} />
                                                <LanguagePicker label="Customer language" value={clientLanguage} hint={contactLanguageHint} onChange={(value) => void persistLanguagePair(agentLanguage, value)} />
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
                            <div><span className="font-medium">Languages:</span> {languageLabel(session.agentLanguage || agentLanguage)} {"->"} {languageLabel(session.clientLanguage || clientLanguage)}</div>
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
                    </CollapsibleContent>
                </Collapsible>
            </div>
        </div>
    );
}
