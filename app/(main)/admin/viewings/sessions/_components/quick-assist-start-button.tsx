"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages, Loader2, Mic, Radio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    VIEWING_SESSION_KINDS,
    VIEWING_SESSION_MODES,
    VIEWING_SESSION_PARTICIPANT_MODES,
    VIEWING_SESSION_QUICK_START_SOURCES,
    VIEWING_SESSION_SPEECH_MODES,
} from "@/lib/viewings/sessions/types";

type Props = {
    label: string;
    locationId?: string | null;
    contactId?: string | null;
    primaryPropertyId?: string | null;
    viewingId?: string | null;
    sessionKind?: string;
    mode?: string;
    quickStartSource?: string;
    variant?: "default" | "outline" | "secondary" | "ghost";
    size?: "default" | "sm" | "lg" | "icon";
    className?: string;
    icon?: "mic" | "radio" | "languages";
};

function getDefaultSpeechMode(sessionKind: string) {
    if (sessionKind === VIEWING_SESSION_KINDS.listenOnly) {
        return VIEWING_SESSION_SPEECH_MODES.listenOnly;
    }
    if (sessionKind === VIEWING_SESSION_KINDS.twoWayInterpreter) {
        return VIEWING_SESSION_SPEECH_MODES.continuous;
    }
    return VIEWING_SESSION_SPEECH_MODES.pushToTalk;
}

function getDefaultLiveMode(sessionKind: string) {
    if (sessionKind === VIEWING_SESSION_KINDS.twoWayInterpreter) {
        return VIEWING_SESSION_MODES.assistantLiveTranslate;
    }
    return VIEWING_SESSION_MODES.assistantLiveToolHeavy;
}

export function QuickAssistStartButton({
    label,
    locationId,
    contactId,
    primaryPropertyId,
    viewingId,
    sessionKind = VIEWING_SESSION_KINDS.quickTranslate,
    mode,
    quickStartSource = VIEWING_SESSION_QUICK_START_SOURCES.global,
    variant = "default",
    size = "sm",
    className,
    icon = "mic",
}: Props) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();

    const handleClick = () => {
        startTransition(async () => {
            try {
                const response = await fetch("/api/viewings/sessions/quick-start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        locationId: locationId || undefined,
                        mode: mode || getDefaultLiveMode(sessionKind),
                        sessionKind,
                        participantMode: VIEWING_SESSION_PARTICIPANT_MODES.agentOnly,
                        speechMode: getDefaultSpeechMode(sessionKind),
                        quickStartSource,
                        entryPoint: quickStartSource,
                        contactId: contactId || undefined,
                        primaryPropertyId: primaryPropertyId || undefined,
                        viewingId: viewingId || undefined,
                    }),
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok || !payload?.success || !payload?.sessionId) {
                    toast.error(payload?.error || "Failed to start quick assist.");
                    return;
                }
                router.push(`/admin/viewings/sessions/${payload.sessionId}`);
                router.refresh();
            } catch (error: any) {
                toast.error(error?.message || "Failed to start quick assist.");
            }
        });
    };

    return (
        <Button type="button" variant={variant} size={size} className={className} onClick={handleClick} disabled={pending}>
            {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : icon === "languages" ? (
                <Languages className="mr-2 h-4 w-4" />
            ) : icon === "radio" ? (
                <Radio className="mr-2 h-4 w-4" />
            ) : (
                <Mic className="mr-2 h-4 w-4" />
            )}
            {label}
        </Button>
    );
}
