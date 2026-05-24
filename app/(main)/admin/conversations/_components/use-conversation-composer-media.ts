import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { type ComposerChannel } from "./use-conversation-composer-translation-preview";

interface UseConversationComposerMediaArgs {
    draft: string;
    isUnavailable: boolean;
    selectedChannel: ComposerChannel;
    sending: boolean;
    setSending: (sending: boolean) => void;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onDraftClear: () => void;
}

export function useConversationComposerMedia({
    draft,
    isUnavailable,
    selectedChannel,
    sending,
    setSending,
    onSendMedia,
    onDraftClear,
}: UseConversationComposerMediaArgs) {
    const [isRecording, setIsRecording] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);

    const stopRecorderTracks = () => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            try {
                mediaRecorderRef.current?.stop();
            } catch {
                // ignore recorder stop race on unmount
            }
            stopRecorderTracks();
        };
    }, []);

    useEffect(() => {
        if (selectedChannel !== "WhatsApp" && mediaRecorderRef.current && isRecording) {
            try {
                mediaRecorderRef.current.stop();
            } catch {
                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);
            }
        }
    }, [selectedChannel, isRecording]);

    const handleMediaPickClick = () => {
        if (isUnavailable || selectedChannel !== "WhatsApp" || !onSendMedia) return;
        fileInputRef.current?.click();
    };

    const handleMediaSelected = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onSendMedia || isUnavailable) return;

        setSending(true);
        try {
            await Promise.resolve(onSendMedia(file, draft));
            onDraftClear();
        } catch (err) {
            console.error("Media send failed", err);
            toast.error("Failed to send media");
        } finally {
            setSending(false);
            e.target.value = "";
        }
    };

    const pickRecorderMimeType = () => {
        const candidates = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/ogg",
            "audio/mp4",
        ];
        for (const candidate of candidates) {
            if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        }
        return "";
    };

    const extensionForAudioMimeType = (mimeType: string) => {
        const normalized = String(mimeType || "").toLowerCase();
        if (normalized.includes("ogg")) return "ogg";
        if (normalized.includes("mp4")) return "m4a";
        if (normalized.includes("mpeg")) return "mp3";
        if (normalized.includes("wav")) return "wav";
        if (normalized.includes("aac")) return "aac";
        return "webm";
    };

    const handleRecordToggle = async () => {
        if (isUnavailable || selectedChannel !== "WhatsApp" || !onSendMedia || sending) return;

        if (isRecording && mediaRecorderRef.current) {
            try {
                mediaRecorderRef.current.stop();
            } catch (err) {
                console.error("Failed stopping recorder", err);
                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);
            }
            return;
        }

        if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            toast.error("Audio recording is not supported in this browser.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = pickRecorderMimeType();
            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            mediaStreamRef.current = stream;
            mediaRecorderRef.current = recorder;
            mediaChunksRef.current = [];

            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data && event.data.size > 0) {
                    mediaChunksRef.current.push(event.data);
                }
            };

            recorder.onerror = (event: Event) => {
                console.error("Recorder error", event);
                toast.error("Recording failed. Please try again.");
                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);
            };

            recorder.onstop = async () => {
                const chunks = [...mediaChunksRef.current];
                mediaChunksRef.current = [];

                const recorderMimeType = recorder.mimeType || mimeType || "audio/webm";
                const blob = new Blob(chunks, { type: recorderMimeType });

                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);

                if (!blob.size) {
                    toast.error("No audio captured. Please try again.");
                    return;
                }

                const file = new File(
                    [blob],
                    `voice-note-${Date.now()}.${extensionForAudioMimeType(recorderMimeType)}`,
                    { type: recorderMimeType }
                );

                setSending(true);
                try {
                    await Promise.resolve(onSendMedia(file, ""));
                } catch (err) {
                    console.error("Voice note send failed", err);
                    toast.error("Failed to send voice note");
                } finally {
                    setSending(false);
                }
            };

            recorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Unable to start audio recording", err);
            toast.error("Microphone access denied or unavailable.");
            stopRecorderTracks();
            mediaRecorderRef.current = null;
            setIsRecording(false);
        }
    };

    return {
        fileInputRef,
        isRecording,
        handleMediaPickClick,
        handleMediaSelected,
        handleRecordToggle,
    };
}
