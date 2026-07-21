export type WhatsAppHistorySyncUiState = {
    status: "idle" | "syncing" | "success" | "error";
    message: string;
};

export function getWhatsAppHistorySyncResultMessage(result: {
    count?: number;
    processed?: number;
    skipped?: number;
    errors?: number;
    identityResolved?: boolean;
}) {
    const imported = Math.max(0, Number(result.count || 0));
    const processed = Math.max(0, Number(result.processed || 0));
    const skipped = Math.max(0, Number(result.skipped || 0));
    const errors = Math.max(0, Number(result.errors || 0));

    if (imported > 0) {
        return `Added ${imported} message${imported === 1 ? "" : "s"} from WhatsApp. The timeline is now up to date.`;
    }
    if (processed > 0 || skipped > 0) {
        return `WhatsApp history is already up to date. Checked ${Math.max(processed, skipped)} message${Math.max(processed, skipped) === 1 ? "" : "s"}.`;
    }
    if (errors > 0) {
        return "WhatsApp history could not be read from the resolved chat. Try again after checking the connection.";
    }
    if (!result.identityResolved) {
        return "No matching WhatsApp chat identity was found for this contact.";
    }
    return "The current WhatsApp chat has no messages available to import.";
}
