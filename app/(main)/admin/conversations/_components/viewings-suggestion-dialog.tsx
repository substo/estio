import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Home, ListTodo, Minus, Plus } from "lucide-react";
import { SearchableSelect } from "@/app/(main)/admin/contacts/_components/searchable-select";
import {
    suggestViewingsFromSelection,
    applySuggestedViewingsFromSelection,
    type ApplySuggestedViewingWarning,
    type SelectionViewingSuggestion,
    getDropdownsForViewingsSuggestion,
} from "@/app/(main)/admin/conversations/actions";
import { toast } from "sonner";

interface ViewingsSuggestionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectionText: string;
    conversationId?: string;
    activeAiModel?: string;
    anchorMessageId?: string;
}

type SuggestedViewingState = SelectionViewingSuggestion & {
    id: string;
    selected: boolean;
    propertyId?: string | null;
    userId?: string;
    duration: number;
};

const VIEWING_DURATION_DEFAULT = 30;
const VIEWING_DURATION_STEP = 15;
const VIEWING_DURATION_MIN = 15;
const VIEWING_DURATION_MAX = 480;

function normalizeViewingDuration(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return VIEWING_DURATION_DEFAULT;
    const snapped = Math.round(parsed / VIEWING_DURATION_STEP) * VIEWING_DURATION_STEP;
    return Math.min(VIEWING_DURATION_MAX, Math.max(VIEWING_DURATION_MIN, snapped));
}

function formatViewingDuration(value: number): string {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    if (hours === 0) return `${minutes} min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
}

function formatViewingSyncWarning(warning: ApplySuggestedViewingWarning): string {
    const missingGoogleCalendar = warning.skippedProviders.some(({ provider, reason }) => (
        provider === "google" && reason === "google_missing_calendar"
    ));

    if (!missingGoogleCalendar) return "";
    return `${warning.description}: Google Calendar was skipped because the assigned agent has no target Google calendar selected.`;
}

export function ViewingsSuggestionDialog({ open, onOpenChange, selectionText, conversationId, activeAiModel, anchorMessageId }: ViewingsSuggestionDialogProps) {
    const [isSuggesting, setIsSuggesting] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [suggestions, setSuggestions] = useState<SuggestedViewingState[]>([]);
    const [resolvedContactId, setResolvedContactId] = useState<string | null>(null);

    // Dropdown data
    const [properties, setProperties] = useState<{ id: string; title: string; reference?: string | null; unitNumber?: string | null }[]>([]);
    const [users, setUsers] = useState<{ id: string; name: string | null; email: string; timeZone?: string | null; effectiveTimeZone?: string | null }[]>([]);

    const loadDropdowns = useCallback(async () => {
        try {
            const data = await getDropdownsForViewingsSuggestion();
            setProperties(data.properties);
            setUsers(data.users);
        } catch (e) {
            console.error("Failed to load dropdowns for viewings:", e);
        }
    }, []);

    const handleGenerateSuggestions = useCallback(async () => {
        if (!selectionText || !conversationId) return;
        setIsSuggesting(true);
        setSuggestions([]);

        try {
            const result = await suggestViewingsFromSelection(
                conversationId,
                selectionText,
                activeAiModel,
                {
                    anchorMessageId,
                    clientNowIso: new Date().toISOString(),
                    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
                }
            );
            if (result.success && result.suggestions) {
                if (result.contactId) setResolvedContactId(result.contactId);
                setSuggestions(result.suggestions.map((s, idx) => ({
                    ...s,
                    duration: normalizeViewingDuration(s.duration),
                    id: `suggestion-${idx}-${Date.now()}`,
                    selected: true,
                })));
            } else {
                toast.error(result.error || "Failed to generate suggestions.");
            }
        } catch (error) {
            toast.error("Failed to generate suggestions.");
        } finally {
            setIsSuggesting(false);
        }
    }, [selectionText, conversationId, activeAiModel, anchorMessageId]);

    useEffect(() => {
        if (open) {
            void loadDropdowns();
            void handleGenerateSuggestions();
        } else {
            setSuggestions([]);
        }
    }, [open, handleGenerateSuggestions, loadDropdowns]);

    const handlePatchSuggestion = (id: string, patch: Partial<SuggestedViewingState>) => {
        setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    };

    const handleApplyViewings = async () => {
        if (!conversationId) return;

        const selectedSuggestions = suggestions.filter((s) => s.selected);
        if (selectedSuggestions.length === 0) return;

        // Verify required fields
        for (const s of selectedSuggestions) {
            if (!s.propertyId) {
                toast.error(`Please select a property for viewing: ${s.propertyDescription}`);
                return;
            }
            if (!s.userId) {
                toast.error(`Please select an assigned agent for viewing: ${s.propertyDescription}`);
                return;
            }
            const selectedAgent = users.find((user) => user.id === s.userId);
            const scheduledTimeZone = selectedAgent?.effectiveTimeZone || selectedAgent?.timeZone || null;
            if (!scheduledTimeZone) {
                toast.error(`Missing timezone for selected agent: ${selectedAgent?.name || selectedAgent?.email || s.userId}`);
                return;
            }
            if (!s.date || !s.time) {
                toast.error(`Please specify date and time for viewing: ${s.propertyDescription}`);
                return;
            }
        }

        setIsApplying(true);

        try {
            if (!resolvedContactId) {
                toast.error("Contact ID missing... please close and retry.");
                setIsApplying(false);
                return;
            }

            const suggestionsPayload = selectedSuggestions.map((s) => {
                const selectedAgent = users.find((user) => user.id === s.userId);
                const scheduledLocal = s.date && s.time ? `${s.date}T${s.time}` : null;
                const scheduledTimeZone = selectedAgent?.effectiveTimeZone || selectedAgent?.timeZone || null;

                return {
                    propertyId: s.propertyId!,
                    propertyDescription: s.propertyDescription,
                    userId: s.userId!,
                    date: s.date!,
                    time: s.time || null,
                    scheduledAtIso: null,
                    scheduledLocal,
                    scheduledTimeZone,
                    notes: s.notes || null,
                    duration: normalizeViewingDuration(s.duration),
                };
            });

            const result = await applySuggestedViewingsFromSelection(
                conversationId,
                resolvedContactId,
                suggestionsPayload,
            );

            if (result.success) {
                if (result.createdCount > 0) {
                    toast.success(`Created ${result.createdCount} viewing(s) successfully!`);
                }
                if ((result.warnings?.length || 0) > 0) {
                    for (const warning of result.warnings) {
                        const message = formatViewingSyncWarning(warning);
                        if (message) {
                            toast.warning(message);
                        }
                    }
                }
                if (result.failedCount > 0) {
                    toast.error(`${result.failedCount} viewing(s) failed to create.`);
                }
                if (result.createdCount > 0) {
                    onOpenChange(false);
                }
            } else {
                toast.error(result.error || "Failed to apply viewings.");
            }
        } catch (error) {
            toast.error("An error occurred while creating viewings.");
        } finally {
            setIsApplying(false);
        }
    };

    const selectedCount = suggestions.filter(s => s.selected).length;

    const propertyOptions = properties.map(p => ({
        value: p.id,
        label: `${p.reference ? `[${p.reference}] ` : ""}${p.unitNumber ? `Unit ${p.unitNumber} - ` : ""}${p.title}`
    }));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Home className="h-4 w-4 text-purple-600" />
                        AI Viewing Suggestions
                    </DialogTitle>
                    <DialogDescription>
                        Generate property viewings from the selected text.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 flex-1 overflow-y-auto pr-2">
                    <div className="rounded-md border bg-slate-50 p-2 text-xs text-slate-600">
                        <span className="font-medium text-slate-800">Selected text:</span>{" "}
                        {selectionText.length > 140 ? `${selectionText.substring(0, 140)}...` : selectionText}
                    </div>

                    {isSuggesting ? (
                        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                            Generating viewing suggestions...
                        </div>
                    ) : null}

                    {!isSuggesting && suggestions.length === 0 ? (
                        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            No viewings found in selection.
                        </div>
                    ) : null}

                    {suggestions.length > 0 ? (
                        <div className="space-y-2">
                            {suggestions.map((suggestion, index) => (
                                <div key={suggestion.id} className="rounded-md border bg-white p-2.5 space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <label className="flex items-start gap-2 flex-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={suggestion.selected}
                                                onChange={(e) => handlePatchSuggestion(suggestion.id, { selected: e.target.checked })}
                                                className="mt-0.5"
                                            />
                                            <span className="text-xs font-medium text-slate-700">Suggestion {index + 1}</span>
                                        </label>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-slate-600">Extracted Property Description</label>
                                        <div className="text-xs bg-slate-50 border p-1.5 rounded">{suggestion.propertyDescription}</div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-slate-600">Select Property <span className="text-red-500">*</span></label>
                                        <SearchableSelect
                                            options={propertyOptions}
                                            value={suggestion.propertyId || ""}
                                            onChange={(val) => handlePatchSuggestion(suggestion.id, { propertyId: val })}
                                            placeholder="-- Select Property --"
                                            searchPlaceholder="Search by title or ref..."
                                            emptyMessage="No property found."
                                            className="w-full text-xs bg-white rounded-md"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-1">
                                            <label className="text-[11px] font-medium text-slate-600">Date</label>
                                            <Input
                                                type="date"
                                                className="h-8 text-xs"
                                                value={suggestion.date || ""}
                                                onChange={(e) => handlePatchSuggestion(suggestion.id, { date: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[11px] font-medium text-slate-600">Time</label>
                                            <Input
                                                type="time"
                                                step={300}
                                                className="h-8 text-xs"
                                                value={suggestion.time || ""}
                                                onChange={(e) => handlePatchSuggestion(suggestion.id, { time: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-slate-600">Duration</label>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => handlePatchSuggestion(suggestion.id, { duration: Math.max(VIEWING_DURATION_MIN, suggestion.duration - VIEWING_DURATION_STEP) })}
                                                disabled={suggestion.duration <= VIEWING_DURATION_MIN}
                                            >
                                                <Minus className="h-3.5 w-3.5" />
                                            </Button>
                                            <div className="flex h-8 min-w-[90px] items-center justify-center rounded-md border bg-slate-50 px-2 text-xs font-medium text-slate-700">
                                                {formatViewingDuration(suggestion.duration)}
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => handlePatchSuggestion(suggestion.id, { duration: Math.min(VIEWING_DURATION_MAX, suggestion.duration + VIEWING_DURATION_STEP) })}
                                                disabled={suggestion.duration >= VIEWING_DURATION_MAX}
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-slate-600">Assign To <span className="text-red-500">*</span></label>
                                        <select
                                            className="w-full text-xs rounded border p-1.5 h-8 bg-white"
                                            value={suggestion.userId || ""}
                                            onChange={(e) => handlePatchSuggestion(suggestion.id, { userId: e.target.value })}
                                        >
                                            <option value="">-- Select Agent --</option>
                                            {users.map(u => (
                                                <option key={u.id} value={u.id}>{u.name || u.email}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-[11px] font-medium text-slate-600">Notes / Instructions</label>
                                        <Textarea
                                            className="min-h-[60px] text-xs"
                                            value={suggestion.notes || ""}
                                            onChange={(e) => handlePatchSuggestion(suggestion.id, { notes: e.target.value })}
                                            placeholder="Extracted context or notes..."
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                <DialogFooter className="mt-4 border-t pt-4">
                    <Button
                        type="button"
                        className="gap-2"
                        disabled={isApplying || isSuggesting || selectedCount === 0}
                        onClick={handleApplyViewings}
                    >
                        {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListTodo className="h-4 w-4" />}
                        {isApplying ? "Applying..." : `Create Selected Viewings (${selectedCount})`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
