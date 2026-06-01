import { useState } from "react";
import { Home, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    buildPropertyMessageInstruction,
    type PropertyMessageLength,
    type PropertyMessagePurpose,
} from "./property-message-instruction";
import { buildPropertySourceText, fetchPropertyUrlContext } from "./property-message-url-client";

type PropertyMessageAssistProps = {
    disabled: boolean;
    generatingDraft: boolean;
    onGenerateInstruction: (instruction: string) => void;
};

export function PropertyMessageAssist({
    disabled,
    generatingDraft,
    onGenerateInstruction,
}: PropertyMessageAssistProps) {
    const [open, setOpen] = useState(false);
    const [propertyUrl, setPropertyUrl] = useState("");
    const [propertyText, setPropertyText] = useState("");
    const [importantDetails, setImportantDetails] = useState("");
    const [purpose, setPurpose] = useState<PropertyMessagePurpose>("new_listing");
    const [length, setLength] = useState<PropertyMessageLength>("medium");
    const [fetchingUrl, setFetchingUrl] = useState(false);
    const [error, setError] = useState("");

    const hasPastedSource = propertyUrl.trim().length > 0 || propertyText.trim().length > 0;
    const hasUrl = propertyUrl.trim().length > 0;
    const isBusy = generatingDraft || fetchingUrl;

    const generateFromSource = (sourceText: string, urlOverride?: string) => {
        const instruction = buildPropertyMessageInstruction({
            propertyUrl: urlOverride || propertyUrl,
            propertyText: sourceText,
            importantDetails,
            purpose,
            length,
        });
        setError("");
        setOpen(false);
        onGenerateInstruction(instruction);
    };

    const handleGenerate = () => {
        if (!hasPastedSource || isBusy) return;
        generateFromSource(propertyText, propertyUrl);
    };

    const handleGenerateFromUrl = async () => {
        if (!hasUrl || isBusy) return;

        setError("");
        setFetchingUrl(true);
        try {
            const payload = await fetchPropertyUrlContext(propertyUrl);
            if (!payload.success || !payload.sourceText) {
                setError(payload?.error || "Could not extract property details from this URL.");
                return;
            }

            generateFromSource(buildPropertySourceText({
                extractedText: payload.sourceText,
                pastedText: propertyText,
            }), payload.url || propertyUrl);
        } catch (urlError: any) {
            setError(urlError?.message || "Could not extract property details from this URL.");
        } finally {
            setFetchingUrl(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || generatingDraft}
                    className="h-7 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 gap-1 px-1.5 sm:px-2"
                    title="Turn property details into a conversational message"
                >
                    {generatingDraft ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                        <Home className="w-3 h-3" />
                    )}
                    Property
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,420px)] p-3" align="start">
                <div className="space-y-3">
                    <div>
                        <div className="text-sm font-medium text-slate-900">Property message</div>
                        <div className="text-xs text-slate-500">Paste listing details or generate directly from a URL.</div>
                    </div>

                    <Input
                        value={propertyUrl}
                        onChange={(event) => setPropertyUrl(event.target.value)}
                        placeholder="Property URL"
                        className="h-8 text-xs"
                    />

                    <Textarea
                        value={propertyText}
                        onChange={(event) => setPropertyText(event.target.value)}
                        placeholder="Paste property text"
                        rows={5}
                        className="min-h-[112px] resize-y text-xs"
                    />

                    <div className="grid grid-cols-2 gap-2">
                        <Select
                            value={purpose}
                            onValueChange={(value) => setPurpose(value as PropertyMessagePurpose)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="new_listing" className="text-xs">New listing</SelectItem>
                                <SelectItem value="follow_up" className="text-xs">Follow-up</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={length}
                            onValueChange={(value) => setLength(value as PropertyMessageLength)}
                        >
                            <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="short" className="text-xs">Short</SelectItem>
                                <SelectItem value="medium" className="text-xs">Medium</SelectItem>
                                <SelectItem value="detailed" className="text-xs">Detailed</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <Textarea
                        value={importantDetails}
                        onChange={(event) => setImportantDetails(event.target.value)}
                        placeholder="Important details to prioritize"
                        rows={2}
                        className="min-h-[64px] resize-y text-xs"
                    />

                    {error ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => setOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 text-xs"
                            disabled={!hasUrl || isBusy}
                            onClick={handleGenerateFromUrl}
                        >
                            {fetchingUrl ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1.5 h-3 w-3" />}
                            Generate from URL
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="h-8 px-3 text-xs"
                            disabled={!hasPastedSource || isBusy}
                            onClick={handleGenerate}
                        >
                            {generatingDraft ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1.5 h-3 w-3" />}
                            Generate
                        </Button>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
