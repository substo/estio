import { useCallback, useState } from "react";
import { toast } from "sonner";

import { improveInternalNoteText } from "@/app/(main)/admin/conversations/actions";

function getDefaultActivityNoteDate() {
    return new Date().toISOString().slice(0, 16);
}

type UseChatWindowActivityNoteArgs = {
    conversationId: string;
    contactId?: string | null;
    onAddActivityEntry?: (entryText: string, dateIso: string) => Promise<void>;
};

export function useChatWindowActivityNote({
    conversationId,
    contactId,
    onAddActivityEntry,
}: UseChatWindowActivityNoteArgs) {
    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [addNoteText, setAddNoteText] = useState("");
    const [addNoteDate, setAddNoteDate] = useState(getDefaultActivityNoteDate);
    const [addingNote, setAddingNote] = useState(false);
    const [improvingNote, setImprovingNote] = useState(false);

    const handleAddNote = useCallback(() => {
        const trimmedNote = addNoteText.trim();
        if (!trimmedNote || !onAddActivityEntry) return;
        const submittedDate = addNoteDate;
        const submittedDateIso = new Date(submittedDate).toISOString();

        setAddingNote(true);
        setAddNoteText("");
        setAddNoteDate(getDefaultActivityNoteDate());
        setAddNoteOpen(false);

        let savePromise: Promise<void>;
        try {
            savePromise = onAddActivityEntry(trimmedNote, submittedDateIso);
        } catch (e: any) {
            setAddingNote(false);
            setAddNoteText(trimmedNote);
            setAddNoteDate(submittedDate);
            setAddNoteOpen(true);
            toast.error(e?.message || "Failed to add note");
            return;
        }

        setAddingNote(false);

        void savePromise
            .then(() => {
                toast.success("Note added to activity log");
            })
            .catch((e: any) => {
                setAddNoteText((current) => current.trim() ? current : trimmedNote);
                setAddNoteDate(submittedDate);
                setAddNoteOpen(true);
                toast.error(e?.message || "Failed to add note");
            });
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
    }, [addNoteText, contactId, conversationId, improvingNote]);

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
