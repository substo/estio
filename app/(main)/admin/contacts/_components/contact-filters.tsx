'use client';

import { useState, useEffect, useTransition, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ChevronDown, RotateCcw, Filter, List, Kanban } from 'lucide-react';
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
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { CONTACT_TYPES, LEAD_GOALS, LEAD_STAGES } from './contact-types';

// --- Constants ---

const REAL_ESTATE_TYPES = ['Lead', 'Contact', 'Tenant'] as const;
const BUSINESS_TYPES = ['Agent', 'Partner', 'Owner', 'Associate', 'Maintenance'] as const;

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
    { value: 'score_desc', label: 'Score: Highest' },
    { value: 'score_asc', label: 'Score: Lowest' },
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
    view?: string;
}

export function ContactFilters({ leadSources = [], agents = [], view = 'table' }: ContactFiltersProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // --- Parse URL State ---
    const urlState = useMemo(() => ({
        q: searchParams.get('q') || '',
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
            if (value === null || value === '' || (value === 'all' && key !== 'category')) {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });

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
    const activeCategory = urlState.category;
    const isRealEstateOrAll = activeCategory === 'real_estate' || activeCategory === 'all';

    let availableTypes: readonly string[] = [];
    if (activeCategory === 'real_estate') {
        availableTypes = REAL_ESTATE_TYPES;
    } else if (activeCategory === 'business') {
        availableTypes = BUSINESS_TYPES;
    } else {
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

    // --- Extracted Render Helpers to reuse across Desktop Block & Mobile Sheet ---
    
    // Core Row Filters
    const renderCategorySelect = (className?: string) => (
        <Select value={activeCategory} onValueChange={(v) => updateParams({ category: v, type: null, priority: null, filter: null })}>
            <SelectTrigger className={cn("w-[140px] h-9 text-xs font-medium", className)}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="real_estate">Real Estate</SelectItem>
                <SelectItem value="business">Business</SelectItem>
                <SelectItem value="all">All Contacts</SelectItem>
            </SelectContent>
        </Select>
    );

    const renderTypeSelect = (className?: string) => (
        <Select value={urlState.type || 'all'} onValueChange={(v) => updateParams({ type: v === 'all' ? null : v })}>
            <SelectTrigger className={cn("w-[130px] h-9 text-xs", !urlState.type && "text-muted-foreground", className)}>
                <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {availableTypes.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    const renderPrioritySelect = (className?: string) => {
        if (!isRealEstateOrAll) return null;
        return (
            <Select value={urlState.priority || 'all'} onValueChange={(v) => updateParams({ priority: v === 'all' ? null : v })}>
                <SelectTrigger className={cn("w-[110px] h-9 text-xs", !urlState.priority && "text-muted-foreground", className)}>
                    <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Any Priority</SelectItem>
                    {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        );
    };

    const renderSortSelect = (className?: string) => (
        <Select value={urlState.sort} onValueChange={(v) => updateParams({ sort: v })}>
            <SelectTrigger className={cn("w-[130px] h-9 text-xs", className)}>
                <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
                {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    );

    // Advanced Filters
    const renderAdvancedFilters = () => (
        <>
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

            <div className="flex gap-1 w-full">
                <Input
                    className="h-9 text-xs min-w-0 flex-1"
                    placeholder="Prop Ref..."
                    value={localPropertyRef}
                    onChange={(e) => setLocalPropertyRef(e.target.value)}
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
        </>
    );

    // --- Render ---
    return (
        <div className="space-y-3 mb-6">

            {/* --- PRIMARY ROW (One-Line) --- */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                {/* Search Input (Takes up available space on mobile, fixed width on desktop) */}
                <div className="relative flex-1 md:flex-none md:w-[220px]">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search..."
                        className="pl-9 pr-8 h-9 w-full"
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

                {/* View Toggle (List / Pipeline) */}
                <div className="flex rounded-md shadow-sm shrink-0">
                    <Button
                        variant={view === 'table' ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 rounded-r-none px-3 gap-1.5"
                        onClick={() => updateParams({ view: null })}
                    >
                        <List className="h-4 w-4" />
                        <span className="hidden sm:inline text-xs">List</span>
                    </Button>
                    <Button
                        variant={view === 'pipeline' ? 'default' : 'outline'}
                        size="sm"
                        className="h-9 rounded-l-none border-l-0 px-3 gap-1.5"
                        onClick={() => updateParams({ view: 'pipeline' })}
                    >
                        <Kanban className="h-4 w-4" />
                        <span className="hidden sm:inline text-xs">Pipeline</span>
                    </Button>
                </div>

                {/* DESKTOP ONLY: Core Filters */}
                <div className="hidden md:flex items-center gap-2">
                    {renderCategorySelect()}
                    {renderTypeSelect()}
                    {renderPrioritySelect()}
                    {renderSortSelect()}

                    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                        <CollapsibleTrigger asChild>
                            <Button
                                variant={activeFilterCount > 0 ? "secondary" : "outline"}
                                size="sm"
                                className="h-9 gap-2"
                            >
                                <Filter className="h-4 w-4" />
                                <span>More</span>
                                {activeFilterCount > 0 && (
                                    <Badge variant="default" className="h-5 px-1.5 text-[10px] rounded-full">{activeFilterCount}</Badge>
                                )}
                                <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", advancedOpen && "rotate-180")} />
                            </Button>
                        </CollapsibleTrigger>
                    </Collapsible>

                    {hasAnyFilter && (
                        <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-9 px-2 text-muted-foreground hover:text-destructive">
                            <RotateCcw className="h-4 w-4" />
                        </Button>
                    )}
                </div>

                {/* MOBILE ONLY: Filters Drawer */}
                <div className="md:hidden shrink-0">
                    <Sheet>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 gap-2 relative">
                                <Filter className="h-4 w-4" />
                                <span className="hidden sm:inline">Filters</span>
                                {(activeFilterCount > 0 || urlState.type || urlState.priority) && (
                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                                    </span>
                                )}
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="bottom" className="h-[85vh] p-0 flex flex-col">
                            <SheetHeader className="p-4 border-b pb-4">
                                <SheetTitle className="text-left">Filter Contacts</SheetTitle>
                            </SheetHeader>
                            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                                {/* Base Filters */}
                                <div className="space-y-4">
                                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Core Grouping</h4>
                                    <div className="grid grid-cols-2 gap-3">
                                        {renderCategorySelect("w-full")}
                                        {renderTypeSelect("w-full")}
                                        {isRealEstateOrAll && renderPrioritySelect("w-full")}
                                        {renderSortSelect("w-full")}
                                    </div>
                                </div>
                                {/* Advanced Filters */}
                                <div className="space-y-4 border-t pt-4">
                                    <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Detailed Search</h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {renderAdvancedFilters()}
                                    </div>
                                </div>
                            </div>
                            {/* Footer Actions */}
                            <div className="border-t p-4 mt-auto bg-background flex justify-between">
                                {hasAnyFilter ? (
                                    <Button variant="ghost" className="text-muted-foreground" onClick={clearAllFilters}>
                                        Clear All
                                    </Button>
                                ) : (
                                    <div></div>
                                )}
                                <SheetTrigger asChild>
                                    <Button>View Results</Button>
                                </SheetTrigger>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>

            {/* --- SECONDARY ROW (Desktop Advanced Filters - Slide Down) --- */}
            <div className="hidden md:block">
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleContent className="animate-slide-down overflow-hidden">
                        <div className="pt-2 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            {renderAdvancedFilters()}
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </div>
        </div>
    );
}
