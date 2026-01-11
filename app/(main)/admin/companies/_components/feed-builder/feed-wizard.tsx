
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowRight, Check, AlertCircle, Play, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { FeedMappingConfig } from '@/lib/feed/ai-mapper';
import { addFeed } from '../../actions';

interface FeedWizardProps {
    companyId: string;
    onSuccess: () => void;
    onCancel: () => void;
}

export function FeedWizard({ companyId, onSuccess, onCancel }: FeedWizardProps) {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const [url, setUrl] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [mapping, setMapping] = useState<FeedMappingConfig | null>(null);
    const [snippet, setSnippet] = useState('');
    const [availablePaths, setAvailablePaths] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    // Preview
    const [previewItems, setPreviewItems] = useState<any[]>([]);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    const handleAnalyze = async () => {
        if (!url) return toast.error("Please enter a URL");

        setIsAnalyzing(true);
        try {
            const res = await fetch('/api/feed/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, companyId })
            });
            const data = await res.json();

            if (data.success) {
                const aiMapping = data.mapping as FeedMappingConfig;
                const paths = data.paths as string[];
                setSnippet(data.snippet);
                setAvailablePaths(paths);

                // Refine Mapping: AI guesses paths, but we have exact paths from discovery.
                // We need to normalize AI suggestions to match strict Discovered Paths.
                const refinedMapping = { ...aiMapping };

                // 1. Refine Root Path
                // AI might say "channel.item", Discovery says "rss.channel.item"
                // Check relative ending match
                if (refinedMapping.rootPath && !paths.includes(refinedMapping.rootPath)) {
                    const match = paths.find(p => p.endsWith(refinedMapping.rootPath || ''));
                    if (match) refinedMapping.rootPath = match;
                }

                // 1b. Fix "Parent" Root Path (e.g. "rss.channel" instead of "rss.channel.item")
                // If the current rootPath has a child that looks like a list item ('item', 'entry', 'property'), switch to it.
                if (refinedMapping.rootPath) {
                    const potentialChildren = ['item', 'entry', 'property', 'listing', 'ad'];
                    const childMatch = potentialChildren.find(child => paths.includes(`${refinedMapping.rootPath}.${child}`));
                    if (childMatch) {
                        refinedMapping.rootPath = `${refinedMapping.rootPath}.${childMatch}`;
                    }
                }


                // 2. Refine Fields (Link AI suggestions to real paths)
                const newFields: any = { ...refinedMapping.fields };

                if (refinedMapping.fields) {
                    Object.keys(newFields).forEach(key => {
                        let val = newFields[key];
                        if (val && !paths.includes(val)) {
                            // Try suffix match
                            const suffixMatch = paths.find(p => p.endsWith('.' + val) || p === val);

                            // Try Root Path based connection
                            if (refinedMapping.rootPath) {
                                const simpleName = val.includes('.') ? val.split('.').pop() : val;
                                const ideal = `${refinedMapping.rootPath}.${simpleName}`;
                                if (paths.includes(ideal)) {
                                    newFields[key] = ideal;
                                    return;
                                }
                            }

                            if (suffixMatch) {
                                newFields[key] = suffixMatch;
                            }
                        }
                    });
                }

                // 3. Heuristic Fallback (Fill in gaps that AI missed)
                // If AI returned null for a field, try to find it by keyword in the discovered paths.
                const KEYWORD_MAP: Record<string, string[]> = {
                    externalId: ['guid', 'id', 'ref', 'reference'],
                    price: ['price', 'amount', 'cost', 'mnimo'],
                    currency: ['currency'],
                    images: ['image', 'photo', 'picture', 'gallery', 'media'],
                    bedrooms: ['bedroom', 'bed'],
                    bathrooms: ['bathroom', 'bath'],
                    areaSqm: ['sqm', 'area', 'size'],
                    city: ['city', 'town', 'location', 'region'],
                    country: ['country']
                };

                CRM_FIELDS.forEach(field => {
                    const fieldKey = field.value;
                    // Only auto-map if currently empty
                    if (!newFields[fieldKey]) {
                        const keywords = KEYWORD_MAP[fieldKey];
                        if (keywords) {
                            // Find a path that contains one of the keywords
                            // AND is relevant (under root path)
                            const match = paths.find(p => {
                                const lower = p.toLowerCase();
                                const keywordMatch = keywords.some(k => lower.endsWith(k) || lower.includes(`.${k}.`) || lower.endsWith(`:${k}`));

                                // Enforce Root Path context if known
                                if (refinedMapping.rootPath) {
                                    return keywordMatch && (p.includes(refinedMapping.rootPath));
                                }
                                return keywordMatch;
                            });

                            if (match) {
                                newFields[fieldKey] = match;
                            }
                        }
                    }
                });

                refinedMapping.fields = newFields;

                setMapping(refinedMapping);
                setStep(2);
                toast.success("Feed analyzed successfully!");
            } else {
                toast.error(data.error || "Analysis failed");
            }
        } catch (e) {
            toast.error("Failed to analyze feed");
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handlePreview = async () => {
        setIsPreviewLoading(true);
        try {
            const res = await fetch('/api/feed/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, mappingConfig: mapping })
            });
            const data = await res.json();
            if (data.success) {
                setPreviewItems(data.items);
            } else {
                toast.error(data.error);
            }
        } catch (e) {
            toast.error("Preview failed");
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // We use the server action but pass the mapping as a hidden field or separate arg
            // Since addFeed expects FormData, we'll wrap it.
            const formData = new FormData();
            formData.append('companyId', companyId);
            formData.append('url', url);
            formData.append('format', 'GENERIC');
            formData.append('mappingConfig', JSON.stringify(mapping));

            const res = await addFeed({ success: false, message: '' }, formData);
            if (res.success) {
                toast.success("Feed saved!");
                onSuccess();
            } else {
                toast.error(res.message);
            }
        } catch (e) {
            toast.error("Failed to save feed");
        } finally {
            setIsSaving(false);
        }
    };


    // CRM Fields Definition
    const CRM_FIELDS = [
        { label: 'Unique ID', value: 'externalId' },
        { label: 'Title', value: 'title' },
        { label: 'Description', value: 'description' },
        { label: 'Price', value: 'price' },
        { label: 'Currency', value: 'currency' },
        { label: 'Images', value: 'images' },
        { label: 'City', value: 'city' },
        { label: 'Country', value: 'country' },
        { label: 'Bedrooms', value: 'bedrooms' },
        { label: 'Bathrooms', value: 'bathrooms' },
        { label: 'Area (Sqm)', value: 'areaSqm' },
    ];

    // Helper to find which CRM field is mapped to a given XML path
    const getMappedCrmField = (xmlPath: string) => {
        if (!mapping || !mapping.fields) return '';
        const entry = Object.entries(mapping.fields).find(([key, value]) => value === xmlPath);
        return entry ? entry[0] : '';
    };

    // Helper to handle mapping change
    const handleMappingChange = (xmlPath: string, newCrmField: string) => {
        if (!mapping) return;

        const newFields = { ...mapping.fields };

        // 1. If this XML path was already mapped to something, we effectively "unmap" it from that field 
        //    by overwriting that field key below, OR if we are setting it to empty/ignore.
        //    Actually, because we store as { crmField: xmlPath }, we just need to set { [newCrmField]: xmlPath }.

        // 2. However, if 'newCrmField' was already mapped to a DIFFERENT path, we overwrite it. This is desired (Last win).

        // 3. Special case: If user selects "Ignore" (empty string), we need to find the key that HAD this path and delete it/set to null.
        if (!newCrmField) {
            const currentField = getMappedCrmField(xmlPath);
            if (currentField) {
                delete (newFields as any)[currentField];
            }
        } else {
            // If we are mapping to a field, we just set it.
            // But valid concern: What if we want to map MULTIPLE xml fields to ONE crm field? (Concatenation?)
            // Current system only supports 1:1. So overwriting is correct.
            (newFields as any)[newCrmField] = xmlPath;
        }

        setMapping({ ...mapping, fields: newFields });
    };

    // Helper: Filter noise from paths
    const filteredPaths = availablePaths.filter(path => {
        // 1. Remove obvious generic metadata
        if (path.startsWith('?xml')) return false;
        if (path.includes('@_xmlns')) return false;
        if (path.includes('@_version')) return false;
        if (path.includes('@_encoding')) return false;
        if (path.endsWith('generator')) return false;
        if (path.endsWith('lastBuildDate')) return false;
        if (path.includes('atom:link')) return false;
        if (path.includes('sy:update')) return false;

        // 2. Focus on Item fields if Root Path is defined
        // The root path from AI might be "channel.item" while discovery found "rss.channel.item".
        // We check if the path ends with the expected relative path, or contains the root path segments.
        if (mapping && mapping.rootPath) {
            // Heuristic: If path suggests it's a sibling of the root (e.g. rss.channel.title vs rss.channel.item.title)
            // We want to KEEP descendants of the root.
            // Normalize: remove generic prefixes like 'rss.'? No, hard to guess.
            // Simply check if path INCLUDES the root path sequence.
            // But AI might return 'item' and path is 'rss.channel.item'. 
            // Just filtering by what AI said is 'rootPath' is a good start.

            // If the path DOES NOT include the root path string, it's likely a parent/sibling metadata.
            // e.g. Root="channel.item". Path="rss.channel.title". "channel.title" does not include "channel.item".
            // Path="rss.channel.item.title". Includes "channel.item". Keep.

            // Exception: Attributes of the item list itself? e.g. rss.channel.item.@_id?
            // That includes 'item'. So it's kept.

            // If the path INCLUDES the root path, it is a child/attribute of the item. Keep it.
            return path.includes(mapping.rootPath);
        }

        return true;
    });

    return (
        <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900 rounded-lg">
            {/* ... Step 1 ... */}
            {step === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="space-y-2">
                        <Label>Feed URL</Label>
                        <div className="flex gap-2">
                            <Input
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                placeholder="https://example.com/feed.xml"
                                disabled={isAnalyzing}
                            />
                            <Button onClick={handleAnalyze} disabled={isAnalyzing || !url}>
                                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                                Analyze
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            We will use Gemini AI to analyze the XML structure and suggest a mapping.
                        </p>
                    </div>
                    <div className="flex justify-start">
                        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                    </div>
                </div>
            )}

            {/* Step 2: Mapping Editor */}
            {step === 2 && mapping && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 h-full flex flex-col">
                    {/* Container with max height to prevent page overflow */}
                    <div className="grid grid-cols-2 gap-4 flex-1 overflow-hidden">

                        {/* Left Column: Form Fields - Scrollable */}
                        <div className="flex flex-col border-r pr-4 h-full overflow-hidden">
                            <h4 className="font-medium text-sm mb-2 shrink-0">Field Mapping</h4>
                            <div className="text-xs text-muted-foreground mb-4 shrink-0 bg-blue-50 dark:bg-blue-950 p-3 rounded-md border border-blue-200 dark:border-blue-800">
                                <p className="font-semibold mb-1">Source-Driven Mapping</p>
                                <p>On the <strong>left</strong> are the fields found in your XML feed.</p>
                                <p>Use the dropdown on the <strong>right</strong> to assign them to a CRM field.</p>
                            </div>

                            <div className="space-y-3 overflow-y-auto flex-1 pr-2">
                                <div className="p-3 border rounded-md bg-white dark:bg-black mb-4">
                                    <Label className="text-xs font-semibold mb-1 block">Root Path (Item Container)</Label>
                                    <Input
                                        value={mapping.rootPath || ''}
                                        onChange={(e) => setMapping({ ...mapping, rootPath: e.target.value })}
                                        className="h-7 text-xs font-mono"
                                        placeholder="e.g. rss.channel.item"
                                    />
                                    <p className="text-[10px] text-muted-foreground mt-1">Defines where the list of properties starts.</p>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-muted-foreground mb-2 px-1">
                                    <div>XML Source Tag</div>
                                    <div>Mapped CRM Field</div>
                                </div>

                                {/* Render FILTERED discovered paths */}
                                {filteredPaths.length === 0 ? (
                                    <div className="text-sm text-yellow-600 p-2">
                                        Warning: No fields found for root "{mapping.rootPath}".
                                        Try verifying the Root Path above or clear it to see all fields.
                                    </div>
                                ) : (
                                    filteredPaths.map((xmlPath) => (
                                        <FormRow
                                            key={xmlPath}
                                            label={xmlPath}
                                            value={getMappedCrmField(xmlPath)}
                                            onChange={(newValue) => handleMappingChange(xmlPath, newValue)}
                                            customOptions={CRM_FIELDS}
                                        />
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Right Column: Preview - Scrollable ... */}
                        <div className="flex flex-col h-full overflow-hidden">
                            <h4 className="font-medium text-sm mb-2 shrink-0">Preview</h4>
                            <div className="bg-white dark:bg-black border rounded p-2 flex-1 overflow-auto text-xs font-mono mb-2">
                                {isPreviewLoading ? (
                                    <div className="flex items-center justify-center h-full">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : previewItems.length > 0 ? (
                                    <pre>{JSON.stringify(previewItems[0], null, 2)}</pre>
                                ) : (
                                    <div className="text-muted-foreground p-4">
                                        Click Preview to test the mapping on real data.
                                    </div>
                                )}
                            </div>
                            <Button variant="outline" size="sm" onClick={handlePreview} disabled={isPreviewLoading} className="w-full shrink-0">
                                Update Preview
                            </Button>
                        </div>
                    </div>

                    <div className="flex justify-between pt-4 border-t shrink-0">
                        <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={onCancel}>Cancel</Button>
                            <Button onClick={handleSave} disabled={isSaving}>
                                {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                                Save Feed
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function FormRow({ label, value, onChange, options, customOptions }: { label: string, value: string, onChange: (v: string) => void, options?: string[], customOptions?: { label: string, value: string }[] }) {

    // Logic for Rich Options (CRM Fields)
    if (customOptions) {
        return (
            <div className="space-y-1">
                <Label className="text-xs break-all truncate block" title={label}>{label}</Label>
                <Select
                    value={value || ''}
                    onValueChange={(newValue) => onChange(newValue === "_ignore_" ? "" : newValue)}
                >
                    <SelectTrigger className="h-7 text-xs font-mono w-full">
                        <SelectValue placeholder="Ignore" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="_ignore_" className="text-xs text-muted-foreground italic">
                            Ignore
                        </SelectItem>
                        {customOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        );
    }

    // Legacy/Simple Options Logic
    const safeOptions = (options || []).length > 0 ? Array.from(new Set([...(options || []), value].filter(Boolean))).sort() : [];

    return (
        <div className="space-y-1">
            <Label className="text-xs">{label}</Label>
            <Select
                value={value || ''}
                onValueChange={onChange}
                disabled={safeOptions.length === 0}
            >
                <SelectTrigger className="h-7 text-xs font-mono w-full">
                    <SelectValue placeholder={safeOptions.length === 0 ? "No fields found" : "Select field..."} />
                </SelectTrigger>
                <SelectContent>
                    {safeOptions.map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-xs font-mono">
                            {opt}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
