import { useCallback, useState } from "react";
import { toast } from "sonner";

import { improveInternalNoteText } from "@/app/(main)/admin/conversations/actions";

function getDefaultActivityNoteDate() {
    return new Date().toISOString().slice(0, 16);
}

type UseChatWindowActivityNoteArgs = {
    conversationId: string;
    contactId?: string | null;
    selectedModel: string;
    onAddActivityEntry?: (entryText: string, dateIso: string) => Promise<void>;
};

export function useChatWindowActivityNote({
    conversationId,
    contactId,
    selectedModel,
    onAddActivityEntry,
}: UseChatWindowActivityNoteArgs) {
    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [addNoteText, setAddNoteText] = useState("");
    const [addNoteDate, setAddNoteDate] = useState(getDefaultActivityNoteDate);
    const [addingNote, setAddingNote] = useState(false);
    const [improvingNote, setImprovingNote] = useState(false);

    const handleAddNote = useCallback(async () => {
        if (!addNoteText.trim() || !onAddActivityEntry) return;
        setAddingNote(true);
        try {
            await onAddActivityEntry(addNoteText.trim(), new Date(addNoteDate).toISOString());
            setAddNoteText("");
            setAddNoteDate(getDefaultActivityNoteDate());
            setAddNoteOpen(false);
            toast.success("Note added to activity log");
        } catch (e: any) {
            toast.error(e?.message || "Failed to add note");
        } finally {
            setAddingNote(false);
        }
    }, [addNoteDate, addNoteText, onAddActivityEntry]);

    const handleImproveNote = useCallback(async () => {
        const sourceText = addNoteText.trim();
        if (!sourceText || improvingNote) return;

        setImprovingNote(true);
        try {
            const result = await improveInternalNoteText({
                text: sourceText,
                noteType: "activity",
                conversationId,
                contactId,
                modelOverride: selectedModel || undefined,
            });
            if (!result.success) {
                toast.error(result.error || "Failed to improve note");
                return;
            }
            setAddNoteText(result.improvedText);
            toast.success("Note improved");
        } catch (error: any) {
            toast.error(error?.message || "Failed to improve note");
        } finally {
            setImprovingNote(false);
        }
    }, [addNoteText, contactId, conversationId, improvingNote, selectedModel]);

    return {
        addNoteOpen,
        setAddNoteOpen,
        addNoteText,
        setAddNoteText,
        addNoteDate,
        setAddNoteDate,
        addingNote,
        improvingNote,
        handleAddNote,
        handleImproveNote,
    };
}
