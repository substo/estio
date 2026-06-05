import { useState } from "react";
import { Home, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    buildPropertyMessageInstruction,
    type PropertyMessageLength,
    type PropertyMessagePurpose,
} from "./property-message-instruction";
import {
    MAX_PROPERTY_MESSAGE_URLS,
    buildPropertySourceText,
    fetchPropertyUrlContext,
    parsePropertyUrls,
    type PropertySourceTextItem,
} from "./property-message-url-client";

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
    const [propertyUrlsText, setPropertyUrlsText] = useState("");
    const [propertyText, setPropertyText] = useState("");
    const [importantDetails, setImportantDetails] = useState("");
    const [purpose, setPurpose] = useState<PropertyMessagePurpose>("new_listing");
    const [length, setLength] = useState<PropertyMessageLength>("short");
    const [fetchingUrl, setFetchingUrl] = useState(false);
    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");

    const parsedUrls = parsePropertyUrls(propertyUrlsText);
    const hasPastedSource = parsedUrls.urls.length > 0 || propertyText.trim().length > 0;
    const hasUrl = parsedUrls.urls.length > 0;
    const isBusy = generatingDraft || fetchingUrl;

    const generateFromSource = (sourceText: string, urlOverride?: string[], closePopover = true) => {
        const instruction = buildPropertyMessageInstruction({
            propertyUrls: urlOverride || parsedUrls.urls,
            propertyText: sourceText,
            importantDetails,
            purpose,
            length,
        });
        setError("");
        if (closePopover) setOpen(false);
        onGenerateInstruction(instruction);
    };

    const handleGenerate = () => {
        if (!hasPastedSource || isBusy) return;
        const nextWarning = parsedUrls.overflowCount > 0
            ? `Using the first ${MAX_PROPERTY_MESSAGE_URLS} URLs and ignoring ${parsedUrls.overflowCount} extra.`
            : "";
        setWarning(nextWarning);
        generateFromSource(propertyText, parsedUrls.urls, !nextWarning);
    };

    const handleGenerateFromUrl = async () => {
        if (!hasUrl || isBusy) return;

        setError("");
        setWarning("");
        setFetchingUrl(true);
        try {
            const results = await Promise.all(parsedUrls.urls.map((url) => fetchPropertyUrlContext(url)));
            const sources: PropertySourceTextItem[] = results
                .filter((payload) => payload.success && payload.sourceText)
                .map((payload) => ({
                    url: payload.url || "",
                    title: payload.title,
                    sourceText: payload.sourceText,
                }));
            const failedResults = results.filter((payload) => !payload.success || !payload.sourceText);
            const sourceText = buildPropertySourceText({
                sources,
                pastedText: propertyText,
            });

            if (!sourceText.trim()) {
                setError(failedResults[0]?.error || "Could not extract property details from these URLs.");
                return;
            }

            const nextWarning = [
                parsedUrls.overflowCount > 0
                    ? `Using the first ${MAX_PROPERTY_MESSAGE_URLS} URLs and ignoring ${parsedUrls.overflowCount} extra.`
                    : null,
                failedResults.length > 0
                    ? `${failedResults.length} URL${failedResults.length === 1 ? "" : "s"} could not be read, so the draft will rely on the readable listings and pasted text.`
                    : null,
            ].filter(Boolean).join(" ");
            setWarning(nextWarning);
            generateFromSource(sourceText, parsedUrls.urls, !nextWarning);
        } catch (urlError: any) {
            setError(urlError?.message || "Could not extract property details from these URLs.");
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
                        <div className="text-xs text-slate-500">Paste listing details or generate options from up to {MAX_PROPERTY_MESSAGE_URLS} URLs.</div>
                    </div>

                    <Textarea
                        value={propertyUrlsText}
                        onChange={(event) => setPropertyUrlsText(event.target.value)}
                        placeholder="Property URLs, one per line"
                        rows={3}
                        className="min-h-[76px] resize-y text-xs"
                    />
                    {parsedUrls.urls.length > 0 || parsedUrls.overflowCount > 0 ? (
                        <div className="text-[11px] text-slate-500">
                            {parsedUrls.urls.length} URL{parsedUrls.urls.length === 1 ? "" : "s"} detected
                            {parsedUrls.overflowCount > 0 ? `, ${parsedUrls.overflowCount} extra ignored` : ""}
                        </div>
                    ) : null}

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
                    {!error && warning ? (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                            {warning}
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
                            Generate from URLs
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
