"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { QUICK_ASSIST_RATES, quickAssistRateLabel, formatQuickAssistCost } from "@/lib/viewings/sessions/quick-assist-cost";
import { QuickAssistUsagePanel, type QuickAssistUsageSnapshot } from "./quick-assist-usage";
import type { QuickAssistModelOption } from "@/lib/viewings/sessions/quick-assist-models";
import {
    ArrowLeft,
    ArrowLeftRight,
    ArrowRight,
    Info,
    Check,
    Languages,
    ChevronsUpDown,
    Loader2,
    Mic,
    MicOff,
    Save,
    Send,
    Settings2,
    Share2,
    Shuffle,
    Volume2,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { LIVE_ASSIST_LANGUAGE_OPTIONS as LANGUAGE_OPTIONS } from "@/lib/viewings/sessions/live-assist-languages";
import { getReplyLanguageLabel, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import {
    sortViewingTranscriptMessages,
    selectEffectiveViewingTranscriptMessages,
} from "@/lib/viewings/sessions/transcript";
import { selectAssistTranscriptRows } from "@/lib/viewings/sessions/assist-transcript-display";
import { applyLiveCaptionPreview, reconcileLiveCaptionPreview, type LiveCaptionPreviews } from "@/lib/viewings/sessions/live-caption-preview";
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

function getMessageSpeakerForSessionKind(sessionKind: string) {
    if (sessionKind === "listen_only") return "client";
    return "agent";
}

function getLiveModeForSessionKind(sessionKind: string) {
    if (sessionKind === "two_way_interpreter") return "assistant_live_translate";
    return "assistant_live_tool_heavy";
}


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
    if (message.speaker === "system" && message.origin === "relay_live_transcript") {
        return { primaryText: message.originalText, isWaitingForTranslation: false };
    }
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
    autoLabel,
    disabled = false,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    hint?: string | null;
    autoLabel?: string;
    disabled?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const resolved = autoLabel && value === "auto" ? "auto" : languageCode(value);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className="h-auto min-h-[64px] w-full justify-between rounded-lg px-3 py-2 text-left hover:bg-muted"
                >
                    <span className="min-w-0">
                        <span className="block text-[11px] font-medium uppercase text-muted-foreground">{label}</span>
                        <span className="block truncate text-base font-semibold text-foreground">{resolved === "auto" ? autoLabel : languageLabel(resolved)}</span>
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
                            {autoLabel && <CommandItem value={autoLabel} onSelect={() => { onChange("auto"); setOpen(false); }}><Check className={cn("mr-2 h-4 w-4", resolved === "auto" ? "opacity-100" : "opacity-0")} />{autoLabel}</CommandItem>}
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
    const [liveCaptions, setLiveCaptions] = useState<LiveCaptionPreviews>({});
    const [summary, setSummary] = useState<SessionSummary | null>(initialSummary);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [livePending, startLiveTransition] = useTransition();
    const [modePending, startModeTransition] = useTransition();
    const [modeSwitchPending, setModeSwitchPending] = useState(false);
    const modeSwitchInFlightRef = useRef(false);
    const [savePending, startSaveTransition] = useTransition();
    const [sending, setSending] = useState(false);
    const [speechOn, setSpeechOn] = useState(false);
    const [micStreaming, setMicStreaming] = useState(false);
    const [relayReady, setRelayReady] = useState(false);
    const [audioPlaybackEnabled, setAudioPlaybackEnabled] = useState(
        initialSession.sessionKind === "two_way_interpreter" ? true : initialSession.audioPlaybackAgentEnabled
    );
    const [textDisplay, setTextDisplay] = useState<"both" | "translation" | "hidden">("both");
    const [voiceVolume, setVoiceVolume] = useState(1);
    const [replayVoiceName, setReplayVoiceName] = useState("automatic");
    const [replayVoices, setReplayVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [broaderDetection, setBroaderDetection] = useState(false);
    const [shareInfo, setShareInfo] = useState<{ url: string | null; token: string; pinCode: string; expiresAt: string } | null>(null);
    const [contextDialogOpen, setContextDialogOpen] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [engineModel, setEngineModel] = useState(initialSession.liveModel && initialSession.liveModel !== "gemini-3.5-live-translate-preview"
        ? initialSession.liveModel : "automatic");
    const [engines, setEngines] = useState<Array<{ provider: string; model: string; configured: boolean; listed: boolean; checkedAt: string | null; error: string | null }>>([]);
    const [providers, setProviders] = useState<{ google: boolean; openai: boolean; codex: boolean } | null>(null);
    const [modelOptions, setModelOptions] = useState<{ assistant: QuickAssistModelOption[]; transcribe: QuickAssistModelOption[] }>({ assistant: [], transcribe: [] });
    const [assistantModel, setAssistantModel] = useState("automatic");
    const [transcribeModel, setTranscribeModel] = useState("automatic");
    const [lastUsedModel, setLastUsedModel] = useState<string | null>(null);
    const [sessionUsage, setSessionUsage] = useState<QuickAssistUsageSnapshot | null>(null);
    const usageVersionRef = useRef<string | null>(null);
    const [usageError, setUsageError] = useState(false);
    const refreshUsage = async (notify = false) => {
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/usage`);
            if (!response.ok) throw new Error("Could not load usage");
            const payload = await response.json();
            setSessionUsage(payload); setUsageError(false);
            const version = `${payload.count}:${payload.totalCost}:${payload.unavailableCount}`;
            if (notify && usageVersionRef.current !== version) window.dispatchEvent(new Event("estio:ai-usage-updated"));
            usageVersionRef.current = version;
        } catch { setUsageError(true); }
    };
    const [engineChecking, setEngineChecking] = useState(false);
    const [selectedContactId, setSelectedContactId] = useState(initialSession.contact?.id || "");
    const [selectedPropertyId, setSelectedPropertyId] = useState(initialSession.primaryProperty?.id || "");
    const [selectedViewingId, setSelectedViewingId] = useState(initialSession.viewing?.id || "");
    const [agentLanguage, setAgentLanguage] = useState(languageCode(initialSession.agentLanguage || "en"));
    const [clientLanguage, setClientLanguage] = useState(languageCode(initialSession.clientLanguage || initialSession.contact?.preferredLang || "en"));
    const [spokenLanguage, setSpokenLanguage] = useState("auto");
    const [languageControlsOpen, setLanguageControlsOpen] = useState(false);
    useEffect(() => {
        try {
            const saved = window.localStorage.getItem("estio:live-assist:spoken-language");
            if (saved === "auto" || LANGUAGE_OPTIONS.some((option) => option.value === saved)) setSpokenLanguage(saved!);
        } catch { /* Storage may be unavailable in private browsing. */ }
    }, []);
    const updateSpokenLanguage = (value: string) => {
        setSpokenLanguage(value);
        try { window.localStorage.setItem("estio:live-assist:spoken-language", value); } catch { /* Keep the selection for this page. */ }
    };
    const [contextNotes, setContextNotes] = useState("");
    const recognizerRef = useRef<SpeechRecognizerLike | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recorderChunksRef = useRef<Blob[]>([]);
    const recorderActiveRef = useRef(false);
    const recorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recordingUploadRef = useRef<Promise<void>>(Promise.resolve());
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const relaySocketRef = useRef<WebSocket | null>(null);
    const autoStartAttemptedRef = useRef(false);
    const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
    const followLiveRef = useRef(true);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const playbackAudioContextRef = useRef<AudioContext | null>(null);
    const playbackCursorRef = useRef(0);
    const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const liveInfoRef = useRef<any>(null);
    const audioPlaybackEnabledRef = useRef(audioPlaybackEnabled);
    const voiceVolumeRef = useRef(voiceVolume);

    const renderedMessages = useMemo(
        () => selectEffectiveViewingTranscriptMessages(sortViewingTranscriptMessages(messages)),
        [messages]
    );
    const participantLabel = session.contact?.name || session.viewing?.contact.name || session.clientName || "Unlinked session";
    const isInterpreterMode = session.sessionKind === "two_way_interpreter";
    const isTranscribeMode = session.sessionKind === "listen_only";
    const isAssistantMode = session.sessionKind === "quick_translate";
    const transcriptRows = selectAssistTranscriptRows(renderedMessages, { isTranslateMode: isInterpreterMode, textDisplay });
    const visibleLiveCaptions = Object.values(liveCaptions).filter((caption) => textDisplay === "both" || caption.channel === "output");
    const twoWay = session.speechMode !== "push_to_talk";
    const checkEngines = async (refresh: boolean) => {
        setEngineChecking(true);
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/translation-engines`, { method: refresh ? "POST" : "GET" });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || "Could not check translation engines.");
            setEngines(payload.engines || []);
            setProviders(payload.providers || null);
            setModelOptions(payload.modelOptions || { assistant: [], transcribe: [] });
        } catch (error) {
            setError(error instanceof Error ? error.message : "Could not check translation engines.");
        } finally {
            setEngineChecking(false);
        }
    };
    useEffect(() => {
        void checkEngines(false);
        void refreshUsage();
        const timer = setInterval(() => void refreshUsage(true), 15000);
        return () => clearInterval(timer);
    }, [session.id]);
    const currentOptions = isAssistantMode ? modelOptions.assistant : modelOptions.transcribe;
    const currentModel = isInterpreterMode ? engineModel : isAssistantMode ? assistantModel : transcribeModel;
    const resolvedOption = currentOptions.find(o => o.value === currentModel) || (currentModel === "automatic" ? currentOptions[0] : undefined);
    const resolvedEngine = engines.find(e => e.listed && e.configured && (!twoWay || e.provider === "google_gemini_live") && (engineModel === "automatic" || e.model === engineModel));
    const resolvedModel = isInterpreterMode ? resolvedEngine?.model : resolvedOption?.value;

    const selectedRate = resolvedModel ? QUICK_ASSIST_RATES[resolvedModel.replace(/^openai:/, "")] : undefined;
    const readyForMode = isInterpreterMode
        ? engines.some((engine) => engine.configured && engine.listed && (engineModel === "automatic" || engine.model === engineModel) && (twoWay ? engine.provider === "google_gemini_live" : true))
        : Boolean(resolvedOption);
    const missingModeConnection = providers !== null && !readyForMode;
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

    const replayTranslatedText = (message: SessionMessage) => {
        if (typeof window === "undefined" || !window.speechSynthesis) {
            setError("Synthesized replay is unavailable in this browser.");
            return;
        }
        const text = message.speaker === "system" ? message.originalText : message.translatedText;
        if (!text?.trim()) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = message.targetLanguage || (message.speaker === "system" ? agentLanguage : resolveMessageTargetLanguage(message, agentLanguage, clientLanguage));
        utterance.volume = voiceVolume;
        if (replayVoiceName !== "automatic") utterance.voice = replayVoices.find((voice) => voice.voiceURI === replayVoiceName) || null;
        window.speechSynthesis.speak(utterance);
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
        const gain = audioContext.createGain();
        gain.gain.value = voiceVolumeRef.current;
        source.connect(gain);
        gain.connect(audioContext.destination);
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

    useEffect(() => { voiceVolumeRef.current = voiceVolume; }, [voiceVolume]);

    useEffect(() => {
        if (!window.speechSynthesis) return;
        const updateVoices = () => setReplayVoices(window.speechSynthesis.getVoices());
        updateVoices();
        window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
        return () => window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
    }, []);

    useEffect(() => {
        recognizerRef.current = createSpeechRecognizer();
        return () => {
            recorderActiveRef.current = false;
            if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
            if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
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

                if (type === "viewing_session.usage.updated") void refreshUsage(true);
                if (type === "viewing_session.message.created" && payload?.message) {
                    const incoming = payload.message as SessionMessage;
                    setMessages((current) => (current.some((item) => item.id === incoming.id) ? current : [...current, incoming]));
                    setLiveCaptions((current) => reconcileLiveCaptionPreview(current, incoming));
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
        const viewport = transcriptScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
        if (!viewport) return;
        const trackScroll = () => {
            followLiveRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
        };
        viewport.addEventListener("scroll", trackScroll);
        const frame = requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
        return () => { cancelAnimationFrame(frame); viewport.removeEventListener("scroll", trackScroll); };
    }, [isInterpreterMode, textDisplay]);

    useEffect(() => {
        if (!followLiveRef.current) return;
        const viewport = transcriptScrollRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }, [messages, liveCaptions]);

    useEffect(() => {
        const timer = setInterval(() => {
            const cutoff = Date.now() - 10_000;
            setLiveCaptions((current) => {
                if (!Object.values(current).some((caption) => caption.updatedAt < cutoff)) return current;
                return Object.fromEntries(Object.entries(current).filter(([, caption]) => caption.updatedAt >= cutoff));
            });
        }, 2_000);
        return () => clearInterval(timer);
    }, []);

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
                ...(isInterpreterMode ? { liveModel: engineModel } : {}),
                audioPlaybackAgentEnabled: audioPlaybackEnabled,
            }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to initialize live transport.");
        }

        const activeSessionId = String(payload?.session?.id || "").trim();
        if (activeSessionId && activeSessionId !== session.id) {
            window.location.replace(`/admin/live-assist/sessions/${encodeURIComponent(activeSessionId)}?autostart=1`);
            return null;
        }

        setSession((current) => ({
            ...current,
            transportStatus: payload?.session?.transportStatus || current.transportStatus,
            liveProvider: payload?.session?.liveProvider || current.liveProvider,
            liveModel: payload?.session?.model || current.liveModel,
            participantMode: payload?.session?.participantMode || current.participantMode,
            sessionKind: payload?.session?.sessionKind || current.sessionKind,
            speechMode: payload?.session?.speechMode || current.speechMode,
            savePolicy: payload?.session?.savePolicy || current.savePolicy,
            audioPlaybackAgentEnabled: !!payload?.session?.audioPlaybackAgentEnabled,
        }));

        liveInfoRef.current = payload.liveAuth || null;
        setEngineModel((current) => current === "automatic" ? current : (payload?.session?.model || current));
        const relayUrl = String(payload?.liveAuth?.relay?.websocketUrl || "").trim();
        const relaySessionToken = String(payload?.liveAuth?.relay?.relaySessionToken || "").trim();
        if (!relayUrl || !relaySessionToken) {
            throw new Error("Live relay is unavailable.");
        }

        const socketUrl = relayUrl.includes("?")
            ? `${relayUrl}&relaySessionToken=${encodeURIComponent(relaySessionToken)}`
            : `${relayUrl}?relaySessionToken=${encodeURIComponent(relaySessionToken)}`;
        relaySocketRef.current?.close();
        const socket = new WebSocket(socketUrl);
        relaySocketRef.current = socket;
        setRelayReady(false);
        socket.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data || "{}");
                if (payload?.type === "relay.vendor.connected") setRelayReady(true);
                if (payload?.type === "relay.transcript.preview" && (payload?.channel === "input" || payload?.channel === "output") && typeof payload?.text === "string") {
                    setLiveCaptions((current) => applyLiveCaptionPreview(current, {
                        channel: payload.channel,
                        targetLanguage: String(payload.targetLanguage || ""),
                        text: payload.text,
                        updatedAt: Date.now(),
                    }));
                }
                if (payload?.type === "relay.audio.chunk" && audioPlaybackEnabledRef.current && payload?.mimeType && payload?.data) {
                    void playPcmAudioChunk(String(payload.mimeType), String(payload.data)).catch(() => undefined);
                }
                if (payload?.type === "relay.error" || payload?.type === "relay.vendor.error" || payload?.type === "relay.vendor.connect_failed" || payload?.type === "relay.vendor.failed") {
                    setRelayReady(false);
                    setError(String(payload?.error || payload?.reason || "Relay transport error."));
                }
            } catch (relayError) {
                console.error("Failed to parse relay websocket payload:", relayError);
            }
        };
        socket.onclose = () => {
            if (relaySocketRef.current !== socket) return;
            relaySocketRef.current = null;
            setRelayReady(false);
            setSession((current) => ({ ...current, transportStatus: "disconnected" }));
        };
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
        if (isInterpreterMode) socket.send(JSON.stringify({ eventType: "translation_detection", broaderDetection }));
        return socket;
    };

    const startLiveMicStream = async () => {
        const socket = relaySocketRef.current && relaySocketRef.current.readyState === WebSocket.OPEN
            ? relaySocketRef.current
            : await connectLiveTransport();
        if (!socket) return;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
            if (!relaySocketRef.current || relaySocketRef.current.readyState !== WebSocket.OPEN) return;
            const input = playbackSourcesRef.current.size > 0
                ? new Float32Array(event.inputBuffer.length)
                : event.inputBuffer.getChannelData(0);
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
        setRelayReady(false);
        const socket = relaySocketRef.current;
        relaySocketRef.current = null;
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                eventType: "audio_input",
                mimeType: "audio/pcm;rate=16000",
                audioStreamEnd: true,
            }));
        }
        socket?.close();
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

    useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.get("autostart") !== "1" || autoStartAttemptedRef.current) return;
        autoStartAttemptedRef.current = true;
        url.searchParams.delete("autostart");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
        void startLiveMicStream().catch((startError) => {
            setError(startError instanceof Error ? startError.message : "Failed to resume live translation.");
        });
    }, []);

    const sendMessage = async (textOverride?: string, inputLanguage?: string) => {
        const text = String(textOverride ?? draft).trim();
        if (!text || sending || modeSwitchInFlightRef.current) return;
        const speaker = isTranscribeMode ? "agent" : getMessageSpeakerForSessionKind(session.sessionKind);
        setSending(true);
        setError(null);
        try {
            const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    speaker,
                    originalText: text,
                    ...(isTranscribeMode || isAssistantMode ? { translatedText: text, targetLanguage: inputLanguage, origin: textOverride ? "browser_stt" : "manual_text" } : {}),
                    originalLanguage: isTranscribeMode || isAssistantMode ? inputLanguage : speaker === "client"
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
            if (isAssistantMode) {
                const answerResponse = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/assistant`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt: text, model: assistantModel }),
                });
                const answerPayload = await answerResponse.json().catch(() => null);
                if (!answerResponse.ok || !answerPayload?.answer) throw new Error(answerPayload?.error || "AI could not answer.");
                setLastUsedModel(`${answerPayload.provider} · ${answerPayload.model}`);
                await refreshUsage(true);
                const saveResponse = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/messages`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ speaker: "system", originalText: answerPayload.answer, translatedText: answerPayload.answer, originalLanguage: agentLanguage, targetLanguage: agentLanguage }),
                });
                if (!saveResponse.ok) throw new Error("AI answered, but the reply could not be saved.");
            }
        } catch (sendError: any) {
            setError(sendError?.message || "Failed to send message.");
        } finally {
            setSending(false);
        }
    };

    const transcribeRecordedAudio = async (file: File) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", transcribeModel);
        formData.append("language", spokenLanguage);
        const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/audio-transcribe`, {
            method: "POST",
            body: formData,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
            throw new Error(payload?.error || "Failed to transcribe audio.");
        }
        setLastUsedModel(`${payload.provider} · ${payload.model}`);
        await refreshUsage(true);
        await sendMessage(payload.transcript, spokenLanguage === "auto" ? undefined : spokenLanguage);
    };

    const toggleFallbackRecorder = async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            recorderActiveRef.current = false;
            if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
            mediaRecorderRef.current.stop();
            return;
        }
        if (micStreaming) {
            stopLiveMicStream();
            return;
        }

        if (isInterpreterMode && typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
            try {
                await startLiveMicStream();
                return;
            } catch (liveError) { throw liveError; }
        }

        if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            setError("This browser cannot capture audio for the selected model. Use a browser with microphone recording support, or type a question in Ask AI.");
            return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaStreamRef.current = stream;
        mediaRecorderRef.current = recorder;
        recorderActiveRef.current = true;
        recorder.ondataavailable = (event: BlobEvent) => {
            if (event.data?.size) recorderChunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
            const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || "audio/webm" });
            recorderChunksRef.current = [];
            if (blob.size) {
                recordingUploadRef.current = recordingUploadRef.current.then(() =>
                    transcribeRecordedAudio(new File([blob], `quick-assist-${Date.now()}.webm`, { type: blob.type }))
                ).catch((transcribeError: any) => setError(transcribeError?.message || "Failed to process recorded audio."));
            }
            if (recorderActiveRef.current) {
                recorder.start();
                recorderTimerRef.current = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 5000);
            } else {
                stream.getTracks().forEach((track) => track.stop());
                mediaRecorderRef.current = null;
                setMicStreaming(false);
            }
        };

        recorder.start();
        recorderTimerRef.current = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 5000);
        setMicStreaming(true);
    };

    const startInterpreterNow = () => {
        if (modeSwitchInFlightRef.current) return;
        startLiveTransition(async () => {
            setError(null);
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
            if (micStreaming) {
                stopLiveMicStream();
                relaySocketRef.current?.close();
                relaySocketRef.current = null;
                await startLiveMicStream();
            }
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

    const switchMode = async (sessionKind: "quick_translate" | "listen_only" | "two_way_interpreter", requestedSpeechMode?: "continuous" | "push_to_talk") => {
        if (modeSwitchInFlightRef.current || micStreaming || sending) return;
        const speechMode = requestedSpeechMode || (sessionKind === "listen_only"
            ? "listen_only"
            : sessionKind === "two_way_interpreter" ? "continuous" : "push_to_talk");
        if (session.sessionKind === sessionKind && session.speechMode === speechMode) return;
        const previousMode = { sessionKind: session.sessionKind, speechMode: session.speechMode };
        modeSwitchInFlightRef.current = true;
        setModeSwitchPending(true);
        setError(null);
        setSession((current) => ({ ...current, sessionKind, speechMode }));
        const startedAt = performance.now();
        try {
                const response = await fetch(`/api/viewings/sessions/${encodeURIComponent(session.id)}/convert`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionKind, speechMode }),
                });
                const payload = await response.json().catch(() => null);
                if (process.env.NODE_ENV === "development") {
                    console.debug("Live Assist mode save", { clientMs: Math.round(performance.now() - startedAt), serverTiming: response.headers.get("Server-Timing") });
                }
                if (!response.ok || !payload?.success) throw new Error(payload?.error || "Failed to update quick mode.");
                setSession((current) => ({
                    ...current,
                    sessionKind: payload?.session?.sessionKind || sessionKind,
                    speechMode: payload?.session?.speechMode || speechMode,
                    audioPlaybackAgentEnabled: current.audioPlaybackAgentEnabled,
                }));
                relaySocketRef.current?.close();
                relaySocketRef.current = null;
        } catch (modeError: any) {
            setSession((current) => ({ ...current, ...previousMode }));
            setError(modeError?.message || "Failed to update quick mode.");
        } finally {
            modeSwitchInFlightRef.current = false;
            setModeSwitchPending(false);
        }
    };

    const enableShareMode = () => {
        if (modeSwitchInFlightRef.current) return;
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
                if (mediaRecorderRef.current?.state === "recording") {
                    recorderActiveRef.current = false;
                    if (recorderTimerRef.current) clearTimeout(recorderTimerRef.current);
                    const recorder = mediaRecorderRef.current;
                    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
                    recorder.stop();
                    await stopped;
                    await recordingUploadRef.current;
                }
                if (micStreaming && !mediaRecorderRef.current) stopLiveMicStream();
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
        <div className="-my-4 flex h-[calc(100dvh-3.5rem)] min-h-0 w-[calc(100%+2rem)] max-w-3xl self-center flex-col gap-3 px-3 py-3 sm:px-6">
            <header className="flex shrink-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <Button asChild variant="ghost" size="icon" className="shrink-0"><Link href="/admin/live-assist" aria-label="Back to Live Assist"><ArrowLeft className="h-5 w-5" /></Link></Button>
                    <div className="min-w-0">
                        <h1 className="text-lg font-semibold tracking-tight">Live Assist</h1>
                        <p className="truncate text-xs text-muted-foreground">{participantLabel === "Unlinked session" ? "New session" : participantLabel} · {session.participantMode === "agent_only" ? "Private" : "Shared"}</p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Dialog>
                        <DialogTrigger asChild><Button type="button" variant="ghost" className="gap-1.5 px-2" aria-label="Session cost and usage details"><Info className="h-4 w-4" /><span className="font-mono text-xs">{sessionUsage ? formatQuickAssistCost(sessionUsage.totalCost) : usageError ? "—" : "…"}</span>{(usageError || !!sessionUsage?.unavailableCount) && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="Some costs unavailable" />}</Button></DialogTrigger>
                        <DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Session cost</DialogTitle><DialogDescription>Usage for this conversation, included in your Today and Month totals.</DialogDescription></DialogHeader><QuickAssistUsagePanel usage={sessionUsage} error={usageError} />{resolvedModel && <p className="text-sm text-muted-foreground">Current model: {resolvedModel}<br />{quickAssistRateLabel(resolvedModel, !isAssistantMode)}</p>}</DialogContent>
                    </Dialog>
                    <Button type="button" variant="ghost" size="icon" aria-label="Advanced settings" onClick={() => setAdvancedOpen(true)}><Settings2 className="h-5 w-5" /></Button>
                    <Sheet open={languageControlsOpen} onOpenChange={setLanguageControlsOpen}>
                        <SheetTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" aria-label="Language settings" title="Language settings" className="hover:bg-muted data-[state=open]:bg-muted">
                                <Languages className="h-5 w-5" aria-hidden="true" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-[min(24rem,calc(100vw-2rem))] overflow-y-auto">
                            <SheetHeader className="mb-4 text-left">
                                <SheetTitle>Languages</SheetTitle>
                                <SheetDescription>{isInterpreterMode ? "Choose the conversation languages and translation direction." : isAssistantMode ? "Choose the spoken language and the language for AI replies." : "Choose the language to transcribe."}</SheetDescription>
                            </SheetHeader>
                            {error && <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
                            {isInterpreterMode ? <div className="grid gap-2">
                                <LanguagePicker
                                    label={isInterpreterMode && !twoWay ? "From" : "Language 1"}
                                    value={agentLanguage}
                                    onChange={(value) => void persistLanguagePair(value, clientLanguage)}
                                />
                                <div className="flex items-center justify-center gap-3">
                                    {isInterpreterMode && <Button
                                        type="button"
                                        variant={twoWay ? "secondary" : "outline"}
                                        size="sm"
                                        className="h-8 w-[72px] gap-1 rounded-full px-1"
                                        aria-pressed={twoWay}
                                        aria-label={`${twoWay ? "Two-way" : "One-way"} translation. Switch to ${twoWay ? "one-way" : "two-way"}.`}
                                        title={`${twoWay ? "Two-way" : "One-way"} translation · click to switch`}
                                        onClick={() => void switchMode("two_way_interpreter", twoWay ? "push_to_talk" : "continuous")}
                                        disabled={modePending || modeSwitchPending || micStreaming}
                                    >
                                        {twoWay ? <ArrowLeftRight className="h-4 w-4 shrink-0" /> : <ArrowRight className="h-4 w-4 shrink-0" />}
                                        <span className="text-[10px]">{twoWay ? "Two-way" : "One-way"}</span>
                                    </Button>}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-[72px] gap-1 rounded-full px-1 text-[10px]"
                                        onClick={swapLanguages}
                                        aria-label="Swap languages"
                                    >
                                        <Shuffle className="h-3.5 w-3.5" />
                                        <span>Swap</span>
                                    </Button>
                                </div>
                                <LanguagePicker
                                    label={isInterpreterMode && !twoWay ? "To" : "Language 2"}
                                    value={clientLanguage}
                                    hint={contactLanguageHint}
                                    onChange={(value) => void persistLanguagePair(agentLanguage, value)}
                                />
                            </div> : <div className="grid gap-2">
                                <LanguagePicker label="Spoken language" value={spokenLanguage} autoLabel="Auto-detect" onChange={updateSpokenLanguage} disabled={micStreaming} hint={micStreaming ? "Stop recording to change" : "Microphone input · no translation"} />
                                {isAssistantMode && <LanguagePicker label="AI reply language" value={agentLanguage} onChange={(value) => void persistLanguagePair(value, clientLanguage)} disabled={micStreaming || sending} hint="Language used for AI answers" />}
                            </div>}
                            {sameInterpreterLanguage && (
                                <div className="px-3 pb-2 text-xs text-amber-700">
                                    Both sides are set to {languageLabel(clientLanguage)}.
                                </div>
                            )}
                        </SheetContent>
                    </Sheet>
                </div>
            </header>

            {error && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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

            <div className="flex min-h-0 flex-1 flex-col">
                <section className="flex min-h-0 flex-1 flex-col">
                    <div className="flex min-h-0 flex-1 flex-col gap-3">
                        <div className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Live Assist mode">
                            <Button type="button" aria-pressed={isInterpreterMode} className="relative h-11 rounded-lg border-0 shadow-none" variant={isInterpreterMode ? "default" : "ghost"} onClick={() => void switchMode("two_way_interpreter")} disabled={modePending || modeSwitchPending || micStreaming || sending}>Translate{modeSwitchPending && isInterpreterMode && <Loader2 className="absolute right-1 top-1 h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}</Button>
                            <Button type="button" aria-pressed={isTranscribeMode} className="relative h-11 rounded-lg border-0 shadow-none" variant={isTranscribeMode ? "default" : "ghost"} onClick={() => void switchMode("listen_only")} disabled={modePending || modeSwitchPending || micStreaming || sending}>Transcribe{modeSwitchPending && isTranscribeMode && <Loader2 className="absolute right-1 top-1 h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}</Button>
                            <Button type="button" aria-pressed={isAssistantMode} className="relative h-11 rounded-lg border-0 shadow-none" variant={isAssistantMode ? "default" : "ghost"} onClick={() => void switchMode("quick_translate")} disabled={modePending || modeSwitchPending || micStreaming || sending}>Ask AI{modeSwitchPending && isAssistantMode && <Loader2 className="absolute right-1 top-1 h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}</Button>
                        </div>
                        <span className="sr-only" role="status">{modeSwitchPending ? "Saving mode…" : ""}</span>
                        {missingModeConnection && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                            <p className="font-medium">{isInterpreterMode ? (twoWay ? "Two-way translation needs an available Google live model for this location." : "Translation needs an available live model for this location.") : isTranscribeMode ? "Transcribe needs a Google or OpenAI API connection for this location." : "Ask AI needs a Google, OpenAI API, or ChatGPT/Codex text connection."}</p>
                            <p className="mt-1">Connect a provider in location settings, then return here and check again. A ChatGPT/Codex subscription can answer text questions, but does not enable live translation or audio transcription.</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                <Button asChild size="sm" variant="outline"><Link href="/admin/settings/integrations/gemini">Connect Google</Link></Button>
                                <Button asChild size="sm" variant="outline"><Link href="/admin/settings/integrations/openai-api">Connect OpenAI API</Link></Button>
                                {isAssistantMode && <Button asChild size="sm" variant="outline"><Link href="/admin/settings/integrations/chatgpt-subscription">Connect ChatGPT/Codex</Link></Button>}
                                <Button type="button" size="sm" variant="ghost" onClick={() => void checkEngines(true)} disabled={engineChecking}>{engineChecking ? "Checking…" : "Check again"}</Button>
                            </div>
                        </div>}

                        {(textDisplay !== "hidden" || !isInterpreterMode) && <ScrollArea ref={transcriptScrollRef} className="min-h-0 flex-1 rounded-2xl bg-muted/30 px-3 py-4" aria-label="Conversation transcript">
                            <div className="space-y-3">
                                {transcriptRows.length === 0 && visibleLiveCaptions.length === 0 && (
                                    <div className="flex min-h-40 items-center justify-center px-4 py-8 text-center text-base text-muted-foreground">
                                        {isTranscribeMode ? "Press Start to capture speech as text." : isInterpreterMode && renderedMessages.length > 0 ? "Waiting for translation…" : isInterpreterMode ? "Press Start to translate both sides of the conversation." : "Ask a question or press Start to speak."}
                                    </div>
                                )}
                                {transcriptRows.map(({ message, sourceOriginalText }, index) => {
                                    const display = getMessageDisplayState(message, agentLanguage, clientLanguage);
                                    return (
                                        <div
                                            key={message.id}
                                            className={cn(
                                                "rounded-2xl bg-background px-4 py-3",
                                                index === transcriptRows.length - 1 && "ring-1 ring-border"
                                            )}
                                        >
                                            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                                                <span>{message.speaker}</span>
                                                <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
                                            </div>
                                            <div className="flex items-start gap-2">
                                                <div className={cn("min-w-0 flex-1 text-base leading-relaxed", display.isWaitingForTranslation ? "text-muted-foreground" : "text-foreground")}>{display.primaryText}</div>
                                                {isInterpreterMode && (message.speaker === "system" || (message.translatedText && message.translatedText !== message.originalText)) && <Button type="button" size="icon" variant="ghost" className="shrink-0" onClick={() => replayTranslatedText(message)} aria-label="Replay translation"><Volume2 className="h-4 w-4" /></Button>}
                                            </div>
                                            {textDisplay === "both" && (sourceOriginalText || display.primaryText !== message.originalText) && <div className="mt-1 text-sm text-muted-foreground">{sourceOriginalText || message.originalText}</div>}
                                        </div>
                                    );
                                })}
                                {isInterpreterMode && visibleLiveCaptions.map((caption) => (
                                    <div key={`${caption.channel}:${caption.targetLanguage}`} className="rounded-2xl border border-primary/30 bg-background px-4 py-3" aria-live="polite">
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            {caption.channel === "output" ? `Live translation · ${languageLabel(caption.targetLanguage)}` : "Live original"}
                                        </div>
                                        <div className="text-base leading-relaxed">{caption.text}</div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>}

                        {isInterpreterMode && textDisplay === "hidden" && <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl bg-muted/30 p-6 text-center text-sm text-muted-foreground">Captions hidden.{(micStreaming || speechOn) ? " Listening and translation continue." : " Press Start when you’re ready."}</div>}
                        {isAssistantMode && (
                            <div className="shrink-0 rounded-xl border bg-background p-3">
                                <Textarea
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    placeholder="Ask for help with this conversation, or use the mic."
                                    className="min-h-[64px] max-h-[120px] resize-none border-0 p-0 text-base shadow-none focus-visible:ring-0"
                                    onKeyDown={(event) => {
                                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                            event.preventDefault();
                                            void sendMessage();
                                        }
                                    }}
                                />
                            </div>
                        )}

                        <div className="shrink-0 space-y-3 border-t bg-background pt-3 pb-[env(safe-area-inset-bottom)]">
                            <div className="flex gap-2">
                                <Button type="button" size="lg" className="min-h-14 flex-1 rounded-2xl text-base" onClick={startInterpreterNow} disabled={modeSwitchPending || livePending || engineChecking || ((!readyForMode || (isAssistantMode && !modelOptions.transcribe.length)) && !micStreaming && !speechOn)}>
                                    {(micStreaming || speechOn) ? <MicOff className="mr-2 h-5 w-5" /> : <Mic className="mr-2 h-5 w-5" />}
                                    {(micStreaming || speechOn) ? "Stop" : "Start"}
                                </Button>
                                {isAssistantMode && (
                                    <Button type="button" size="lg" variant="outline" className="min-h-14 rounded-2xl sm:w-32" onClick={() => sendMessage()} disabled={modeSwitchPending || !draft.trim() || sending || missingModeConnection}>
                                        {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                        Send
                                    </Button>
                                )}
                            </div>
                            <div className="text-center text-xs text-muted-foreground" role="status">{micStreaming && isInterpreterMode && !relayReady ? "Connecting to live translation…" : (micStreaming || speechOn) ? "Listening…" : engineChecking ? "Checking models…" : isInterpreterMode ? "Speak naturally in either selected language." : isTranscribeMode ? "Capture speech as text." : "Type a question or use the microphone."}</div>
                            {isInterpreterMode && <div className="flex items-center justify-between gap-2">
                                <label className="flex shrink-0 items-center gap-2 text-sm"><Volume2 className="h-4 w-4" /><span>Voice {audioPlaybackEnabled ? "on" : "muted"}</span><Switch checked={audioPlaybackEnabled} onCheckedChange={setAudioPlaybackEnabled} aria-label="Translated voice" /></label>
                                <Select value={textDisplay} onValueChange={(value) => setTextDisplay(value as typeof textDisplay)}><SelectTrigger className="h-10 w-auto min-w-0 max-w-[55%] border-0 text-xs shadow-none" aria-label="Text display"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">Original + translation</SelectItem><SelectItem value="translation">Translation</SelectItem><SelectItem value="hidden">Hide captions</SelectItem></SelectContent></Select>
                            </div>}
                        </div>
                    </div>
                </section>

                <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
                        <DialogHeader><DialogTitle>Advanced</DialogTitle><DialogDescription>Models, conversation context, voice and saving.</DialogDescription></DialogHeader>
                        <div className="rounded-xl border p-3 space-y-2">
                            <Label htmlFor="quick-assist-model">{isInterpreterMode ? "Translation model" : isTranscribeMode ? "Transcription model" : "AI answer model"}</Label>
                            <Select value={currentModel} onValueChange={value => { setLastUsedModel(null); if (isInterpreterMode) { setEngineModel(value); relaySocketRef.current?.close(); } else if (isAssistantMode) setAssistantModel(value); else setTranscribeModel(value); }} disabled={micStreaming || sending || modePending || engineChecking}>
                                <SelectTrigger id="quick-assist-model"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="automatic">Automatic{resolvedModel && currentModel === "automatic" ? ` · ${resolvedModel}` : ""}</SelectItem>
                                    {isInterpreterMode ? engines.map(engine => <SelectItem key={engine.model} value={engine.model} disabled={!engine.configured || !engine.listed || (twoWay && engine.provider !== "google_gemini_live")}>{engine.provider === "google_gemini_live" ? "Google" : "OpenAI API"} · {engine.model}</SelectItem>) : currentOptions.map(option => <SelectItem key={option.value} value={option.value}>{option.provider} · {option.model}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">{resolvedModel ? `${isInterpreterMode ? resolvedEngine?.provider === "google_gemini_live" ? "Google" : "OpenAI API" : resolvedOption?.provider} · ${resolvedModel}` : engineChecking ? "Checking connections…" : "No available model selected"}</p>
                            {resolvedModel && <p className="text-xs text-muted-foreground">{quickAssistRateLabel(resolvedModel, !isAssistantMode)}</p>}
                            {selectedRate && <a className="block text-xs underline text-muted-foreground" href={selectedRate.sourceUrl} target="_blank" rel="noreferrer">Provider rates · verified {selectedRate.verifiedAt}</a>}
                            {isAssistantMode && <div className="space-y-2 border-t pt-2"><Label htmlFor="quick-assist-mic-model">Microphone transcription model</Label><Select value={transcribeModel} onValueChange={setTranscribeModel} disabled={micStreaming || sending}><SelectTrigger id="quick-assist-mic-model"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="automatic">Automatic · {modelOptions.transcribe[0]?.model || "not connected"}</SelectItem>{modelOptions.transcribe.map(option => <SelectItem key={option.value} value={option.value}>{option.provider} · {option.model}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">{quickAssistRateLabel(transcribeModel === "automatic" ? modelOptions.transcribe[0]?.value || "" : transcribeModel, true)} Speech transcription is charged separately from the answer.</p></div>}
                            {isAssistantMode && !modelOptions.transcribe.length && <p className="text-xs text-amber-700">Connect Google or OpenAI API to speak a question. You can still type a question for Codex.</p>}
                            {lastUsedModel && <p className="text-xs">Last used: {lastUsedModel}</p>}
                        </div>
                        {isInterpreterMode && <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Translation Engine</CardTitle><CardDescription>Choose an available live interpreter for this location.</CardDescription></CardHeader>
                            <CardContent className="space-y-3">
                                <div className="space-y-1 text-xs text-muted-foreground">
                                    {engines.map((engine) => <div key={engine.provider}>{engine.provider === "google_gemini_live" ? "Google" : "OpenAI API"}: {engine.provider === session.liveProvider && session.transportStatus === "connected" ? "live connection active" : engine.listed ? "listed for this location; live access checked on connection" : engine.error || "Unavailable"}</div>)}
                                    <div>Last checked: {engines.find((engine) => engine.checkedAt)?.checkedAt ? new Date(engines.find((engine) => engine.checkedAt)!.checkedAt!).toLocaleString() : "Never"}</div>
                                </div>
                                <Button type="button" variant="outline" onClick={() => void checkEngines(true)} disabled={engineChecking}>{engineChecking ? "Checking…" : "Check available models"}</Button>
                            </CardContent>
                        </Card>}
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Voice & Detection</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-1.5"><Label>Replay voice</Label><Select value={replayVoiceName} onValueChange={setReplayVoiceName}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="automatic">Automatic for language</SelectItem>{replayVoices.map((voice) => <SelectItem key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</SelectItem>)}</SelectContent></Select></div>
                                <div className="space-y-1.5"><Label htmlFor="quick-assist-volume">Voice volume</Label><input id="quick-assist-volume" type="range" min="0" max="1" step="0.05" value={voiceVolume} onChange={(event) => setVoiceVolume(Number(event.target.value))} className="w-full" /></div>
                                <p className="text-xs text-muted-foreground">Replay uses your device’s available voices. The live translated voice is chosen by the provider.</p>
                                <label className="flex items-center justify-between gap-3 text-sm">Detect languages beyond the selected pair <Switch checked={broaderDetection} onCheckedChange={(value) => { setBroaderDetection(value); if (relaySocketRef.current?.readyState === WebSocket.OPEN) relaySocketRef.current.send(JSON.stringify({ eventType: "translation_detection", broaderDetection: value })); }} /></label>
                                <p className="text-xs text-muted-foreground">Broader detection lets the engine translate other detected source languages into the selected targets.</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Context</CardTitle>
                                <CardDescription>{session.contact?.name || "No contact attached"}{session.primaryProperty?.title ? ` · ${session.primaryProperty.title}` : ""}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
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

                        <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                            <div className="text-xs text-muted-foreground">{session.participantMode === "agent_only" ? "Private conversation" : "Shared conversation"} · {session.transportStatus}<br />{session.assignmentStatus === "assigned" ? "Assigned" : "Not attached to a contact yet"}</div>
                            <Button type="button" variant="outline" onClick={enableShareMode} disabled={modePending || modeSwitchPending || session.participantMode === "shared_client"}><Share2 className="mr-2 h-4 w-4" />Share</Button>
                        </div>
                <div className="space-y-4">
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

                    {summary?.sessionSummary && <Card>
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
                    </Card>}

                </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}
