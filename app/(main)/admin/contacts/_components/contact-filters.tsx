'use client';

import { useState, useEffect, useTransition, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ChevronDown, RotateCcw, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { CONTACT_TYPES, LEAD_GOALS, LEAD_STAGES } from './contact-types';

// --- Constants ---

const REAL_ESTATE_TYPES = ['Lead', 'Contact', 'Tenant'] as const;
const BUSINESS_TYPES = ['Agent', 'Partner', 'Owner', 'Associate'] as const;

const PRIORITIES = ['Low', 'Medium', 'High'] as const;

const QUICK_FILTERS = [
    { value: 'needs_follow_up', label: 'Needs Follow Up' },
    { value: 'created_7d', label: 'Created Last 7 Days' },
    { value: 'created_1m', label: 'Created Last 1 Month' },
    { value: 'created_3m', label: 'Created Last 3 Months' },
    { value: 'created_6m', label: 'Created Last 6 Months' },
    { value: 'not_updated_1m', label: 'Not Updated For 1 Month' },
    { value: 'not_updated_3m', label: 'Not Updated For 3 Months' },
    { value: 'not_updated_6m', label: 'Not Updated For 6 Months' },
    { value: 'not_assigned', label: 'Not Assigned To An Agent' },
    { value: 'has_manual_matches', label: 'Has Matched Properties To Manually Email' },
] as const;

const SORT_OPTIONS = [
    { value: 'updated_desc', label: 'Update: Newest' },
    { value: 'updated_asc', label: 'Update: Oldest' },
    { value: 'created_desc', label: 'Created: Newest' },
    { value: 'created_asc', label: 'Created: Oldest' },
] as const;

const DATE_PRESETS = [
    { value: 'today', label: 'Today' },
    { value: 'yesterday', label: 'Yesterday' },
    { value: 'last_7d', label: 'Last 7 Days' },
    { value: 'last_30d', label: 'Last 30 Days' },
    { value: 'this_month', label: 'This Month' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'last_3m', label: 'Last 3 Months' },
] as const;

const DISTRICTS = [
    'Paphos', 'Nicosia', 'Famagusta', 'Limassol', 'Larnaca'
] as const;

// --- Props ---

interface ContactFiltersProps {
    leadSources?: string[];
    agents?: { id: string; name: string | null; email: string }[];
}

export function ContactFilters({ leadSources = [], agents = [] }: ContactFiltersProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // --- Parse URL State ---
    const urlState = useMemo(() => ({
        q: searchParams.get('q') || '',
        // Default category is still 'real_estate' if undefined, but logic now handles 'all'
        category: searchParams.get('category') || 'real_estate',
        type: searchParams.get('type') || '',
        priority: searchParams.get('priority') || '',
        filter: searchParams.get('filter') || '',
        sort: searchParams.get('sort') || 'updated_desc',
        source: searchParams.get('source') || '',
        agent: searchParams.get('agent') || '',
        goal: searchParams.get('goal') || '',
        stage: searchParams.get('stage') || '',
        district: searchParams.get('district') || '',
        propertyRef: searchParams.get('propertyRef') || '',
        createdPreset: searchParams.get('createdPreset') || '',
        updatedPreset: searchParams.get('updatedPreset') || '',
    }), [searchParams]);

    // Local state for controlled inputs
    const [query, setQuery] = useState(urlState.q);
    const [localPropertyRef, setLocalPropertyRef] = useState(urlState.propertyRef);

    // Sync local state with URL
    useEffect(() => {
        setQuery(urlState.q);
        setLocalPropertyRef(urlState.propertyRef);
    }, [urlState.q, urlState.propertyRef]);

    // Debounce search query
    useEffect(() => {
        const timer = setTimeout(() => {
            if (query !== urlState.q) {
                updateParams({ q: query });
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [query]);

    // --- URL Update Helper ---
    const updateParams = (updates: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams);

        Object.entries(updates).forEach(([key, value]) => {
            // Special handling for category: 'all' is a valid value we want to keep in URL
            if (value === null || value === '' || (value === 'all' && key !== 'category')) {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });

        // Reset page on filter change
        params.delete('page');

        startTransition(() => {
            router.push(`/admin/contacts?${params.toString()}`);
        });
    };

    const clearAllFilters = () => {
        setQuery('');
        setLocalPropertyRef('');
        setAdvancedOpen(false);
        router.push('/admin/contacts');
    };

    // --- Derived State ---
    const activeCategory = urlState.category; // 'real_estate', 'business', 'all'
    const isRealEstateOrAll = activeCategory === 'real_estate' || activeCategory === 'all';

    // Determine which types to show in dropdown
    let availableTypes: readonly string[] = [];
    if (activeCategory === 'real_estate') {
        availableTypes = REAL_ESTATE_TYPES;
    } else if (activeCategory === 'business') {
        availableTypes = BUSINESS_TYPES;
    } else {
        // 'all' - show generic or merged? 
        // For simplicity and space, we might just show ALL types or let them search by text.
        // Let's merge them for the "All Contacts" view if they want to filter specific type.
        availableTypes = [...REAL_ESTATE_TYPES, ...BUSINESS_TYPES];
    }

    const activeFilterCount = [
        urlState.filter,
        urlState.source,
        urlState.agent,
        urlState.goal,
        urlState.stage,
        urlState.district,
        urlState.propertyRef,
        urlState.createdPreset,
        urlState.updatedPreset,
    ].filter(Boolean).length;

    const hasAnyFilter = urlState.q || urlState.type || urlState.priority || activeFilterCount > 0;

    // --- Render ---
    return (
        <div className="space-y-3 mb-6">

            {/* --- PRIMARY ROW (One-Line) --- */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Search Input (Fixed Width) */}
                <div className="relative w-[220px]">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search..."
                        className="pl-9 pr-8 h-9"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                        <button
                            onClick={() => { setQuery(''); updateParams({ q: null }); }}
                            className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Category Select (View Mode) */}
                {/* Replaces the toggle switch with a dropdown for better density and "All" option */}
                <Select
                    value={activeCategory}
                    onValueChange={(v) => updateParams({ category: v, type: null, priority: null, filter: null })}
                >
                    <SelectTrigger className="w-[140px] h-9 text-xs font-medium">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="real_estate">Real Estate</SelectItem>
                        <SelectItem value="business">Business</SelectItem>
                        <SelectItem value="all">All Contacts</SelectItem>
                    </SelectContent>
                </Select>

                {/* Type Select */}
                <Select value={urlState.type || 'all'} onValueChange={(v) => updateParams({ type: v === 'all' ? null : v })}>
                    <SelectTrigger className={cn("w-[130px] h-9 text-xs", !urlState.type && "text-muted-foreground")}>
                        <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {availableTypes.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Priority Select (Real Estate OR All) */}
                {isRealEstateOrAll && (
                    <Select value={urlState.priority || 'all'} onValueChange={(v) => updateParams({ priority: v === 'all' ? null : v })}>
                        <SelectTrigger className={cn("w-[110px] h-9 text-xs", !urlState.priority && "text-muted-foreground")}>
                            <SelectValue placeholder="Priority" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Any Priority</SelectItem>
                            {PRIORITIES.map((p) => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* Sort Select */}
                <Select value={urlState.sort} onValueChange={(v) => updateParams({ sort: v })}>
                    <SelectTrigger className="w-[130px] h-9 text-xs">
                        <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                        {SORT_OPTIONS.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/* Advanced Toggle */}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                        <Button
                            variant={activeFilterCount > 0 ? "secondary" : "outline"}
                            size="sm"
                            className="h-9 w-9 p-0 md:w-auto md:px-3 gap-2"
                        >
                            <Filter className="h-4 w-4" />
                            <span className="hidden md:inline">More</span>
                            {activeFilterCount > 0 && (
                                <Badge variant="default" className="h-5 px-1.5 text-[10px] rounded-full">{activeFilterCount}</Badge>
                            )}
                            <ChevronDown className={cn("h-3 w-3 transition-transform duration-200 hidden md:block", advancedOpen && "rotate-180")} />
                        </Button>
                    </CollapsibleTrigger>
                </Collapsible>

                {/* Clear All - only show if filters active */}
                {hasAnyFilter && (
                    <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-9 px-2 text-muted-foreground hover:text-destructive">
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                )}
            </div>

            {/* --- SECONDARY ROW (Expanded - Slide Down) --- */}
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleContent className="animate-slide-down overflow-hidden">
                    <div className="pt-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {/* Quick Filter */}
                        <Select value={urlState.filter || 'all'} onValueChange={(v) => updateParams({ filter: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.filter && "text-muted-foreground")}>
                                <SelectValue placeholder="Quick Filter" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Quick Filter...</SelectItem>
                                {QUICK_FILTERS.map((f) => (
                                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Source */}
                        <Select value={urlState.source || 'all'} onValueChange={(v) => updateParams({ source: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.source && "text-muted-foreground")}>
                                <SelectValue placeholder="Source" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Source...</SelectItem>
                                {leadSources.map((s) => (
                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Agent */}
                        <Select value={urlState.agent || 'all'} onValueChange={(v) => updateParams({ agent: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.agent && "text-muted-foreground")}>
                                <SelectValue placeholder="Agent" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Agent...</SelectItem>
                                {agents.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>{a.name || a.email}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Goal */}
                        <Select value={urlState.goal || 'all'} onValueChange={(v) => updateParams({ goal: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.goal && "text-muted-foreground")}>
                                <SelectValue placeholder="Goal" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Goal...</SelectItem>
                                {LEAD_GOALS.map((g) => (
                                    <SelectItem key={g} value={g}>{g}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Stage */}
                        <Select value={urlState.stage || 'all'} onValueChange={(v) => updateParams({ stage: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.stage && "text-muted-foreground")}>
                                <SelectValue placeholder="Stage" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Stage...</SelectItem>
                                {LEAD_STAGES.map((s) => (
                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* District */}
                        <Select value={urlState.district || 'all'} onValueChange={(v) => updateParams({ district: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.district && "text-muted-foreground")}>
                                <SelectValue placeholder="District" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">District...</SelectItem>
                                {DISTRICTS.map((d) => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Created Date */}
                        <Select value={urlState.createdPreset || 'all'} onValueChange={(v) => updateParams({ createdPreset: v === 'all' ? null : v })}>
                            <SelectTrigger className={cn("h-9 text-xs w-full", !urlState.createdPreset && "text-muted-foreground")}>
                                <SelectValue placeholder="Created" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Created...</SelectItem>
                                {DATE_PRESETS.map((p) => (
                                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Property Ref (Input + Button blended) */}
                        <div className="flex gap-1 col-span-1 md:col-span-2 lg:col-span-1">
                            <Input
                                className="h-9 text-xs min-w-0"
                                placeholder="Prop Ref..."
                                value={localPropertyRef}
                                onChange={(e) => setLocalPropertyRef(e.target.value)}
                                // Submit on enter
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') updateParams({ propertyRef: localPropertyRef || null });
                                }}
                            />
                            {localPropertyRef !== urlState.propertyRef && (
                                <Button size="sm" variant="secondary" className="h-9 px-2 text-xs" onClick={() => updateParams({ propertyRef: localPropertyRef || null })}>
                                    Apply
                                </Button>
                            )}
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
