"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, RotateCcw, Filter, SlidersHorizontal, ChevronDown, X, ChevronUp, Bookmark, Check } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetFooter,
    SheetTrigger,
} from "@/components/ui/sheet";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";

import { PROPERTY_CONDITIONS, PUBLIC_FEATURES_LIST } from "@/lib/properties/filter-constants";
import { PropertyTypeFilter } from "@/components/properties/property-type-filter";
import { LocationFilter } from "@/components/properties/location-filter";
import { BedroomsFilter } from "@/components/properties/bedrooms-filter";
import { FeaturesFilter } from "@/components/properties/features-filter";
import { cn } from "@/lib/utils";
import { saveSearch } from "@/app/actions/public-user";

interface SearchFiltersProps {
    primaryColor?: string;
    resultsCount?: number;
}

const PRICE_POINTS = [
    50000, 75000, 100000, 125000, 150000, 175000, 200000,
    250000, 300000, 350000, 400000, 450000, 500000,
    600000, 700000, 800000, 900000, 1000000,
    1250000, 1500000, 1750000, 2000000, 2500000, 3000000,
    4000000, 5000000, 10000000
];

const RENT_PRICE_POINTS = [
    500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000,
    4000, 5000, 7500, 10000
];

export function SearchFilters({ primaryColor, resultsCount }: SearchFiltersProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [priceOpen, setPriceOpen] = useState(false);
    const [isSaving, startSaving] = useTransition();
    const [saveSuccess, setSaveSuccess] = useState(false);
    const { isSignedIn } = useAuth();

    // Initial state from URL
    const initialStatus = searchParams.get('status') || 'any';
    const initialCategories = searchParams.get('categories')?.split(',').filter(Boolean) || [];
    const initialTypes = searchParams.get('types')?.split(',').filter(Boolean) || [];
    const initialLocations = searchParams.get('locations')?.split(',').filter(Boolean) || [];
    const initialAreas = searchParams.get('areas')?.split(',').filter(Boolean) || [];
    const initialBedrooms = searchParams.get('bedrooms')?.split(',').filter(Boolean) || [];
    const initialFeatures = searchParams.get('features')?.split(',').filter(Boolean) || [];
    const initialMinPrice = searchParams.get('min_price') || '';
    const initialMaxPrice = searchParams.get('max_price') || '';
    const initialReference = searchParams.get('reference') || '';
    const initialCondition = searchParams.get('condition') || 'any';

    const [filters, setFilters] = useState({
        status: initialStatus,
        categories: initialCategories,
        types: initialTypes,
        locations: initialLocations,
        areas: initialAreas,
        bedrooms: initialBedrooms,
        features: initialFeatures,
        minPrice: initialMinPrice,
        maxPrice: initialMaxPrice,
        reference: initialReference,
        condition: initialCondition,
    });

    useEffect(() => {
        setFilters({
            status: searchParams.get('status') || 'any',
            categories: searchParams.get('categories')?.split(',').filter(Boolean) || [],
            types: searchParams.get('types')?.split(',').filter(Boolean) || [],
            locations: searchParams.get('locations')?.split(',').filter(Boolean) || [],
            areas: searchParams.get('areas')?.split(',').filter(Boolean) || [],
            bedrooms: searchParams.get('bedrooms')?.split(',').filter(Boolean) || [],
            features: searchParams.get('features')?.split(',').filter(Boolean) || [],
            minPrice: searchParams.get('min_price') || '',
            maxPrice: searchParams.get('max_price') || '',
            reference: searchParams.get('reference') || '',
            condition: searchParams.get('condition') || 'any',
        });
    }, [searchParams]);

    // Update specific filter
    const updateFilter = (key: string, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    // Apply filters to URL
    const handleSearch = (overrides?: Partial<typeof filters>) => {
        const active = { ...filters, ...overrides };
        const params = new URLSearchParams();

        if (active.status && active.status !== 'any') params.set('status', active.status);
        if (active.reference) params.set('reference', active.reference);

        if (active.locations.length > 0) params.set('locations', active.locations.join(','));
        if (active.areas.length > 0) params.set('areas', active.areas.join(','));
        if (active.categories.length > 0) params.set('categories', active.categories.join(','));
        if (active.types.length > 0) params.set('types', active.types.join(','));
        if (active.bedrooms.length > 0) params.set('bedrooms', active.bedrooms.join(','));
        if (active.features.length > 0) params.set('features', active.features.join(','));
        if (active.condition && active.condition !== 'any') params.set('condition', active.condition);

        if (active.minPrice && active.minPrice !== '0') params.set('min_price', active.minPrice);
        if (active.maxPrice && active.maxPrice !== '0') {
            const maxLimit = active.status === 'rent' ? 10000 : 10000000;
            if (parseInt(active.maxPrice) < maxLimit) {
                params.set('max_price', active.maxPrice);
            }
        }

        router.push(`/properties/search?${params.toString()}`);
        setIsMobileOpen(false);
        setPriceOpen(false);
    };

    const handleReset = () => {
        setFilters({
            status: 'any',
            categories: [],
            types: [],
            locations: [],
            areas: [],
            bedrooms: [],
            features: [],
            minPrice: '',
            maxPrice: '',
            reference: '',
            condition: 'any',
        });
        router.push('/properties/search');
    };

    const activePricePoints = filters.status === 'rent' ? RENT_PRICE_POINTS : PRICE_POINTS;

    const activeFiltersCount = [
        filters.features.length > 0,
        filters.condition !== 'any',
        filters.reference !== '',
    ].filter(Boolean).length;

    // Check if any filters are applied (for Save Search button visibility)
    const hasActiveFilters =
        filters.status !== 'any' ||
        filters.locations.length > 0 ||
        filters.types.length > 0 ||
        filters.bedrooms.length > 0 ||
        filters.minPrice !== '' ||
        filters.maxPrice !== '';

    const handleSaveSearch = () => {
        if (!isSignedIn) {
            router.push(`/sign-in?redirect_url=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            return;
        }
        startSaving(async () => {
            const result = await saveSearch({
                status: filters.status !== 'any' ? filters.status : undefined,
                locations: filters.locations,
                areas: filters.areas,
                categories: filters.categories,
                types: filters.types,
                bedrooms: filters.bedrooms,
                features: filters.features,
                minPrice: filters.minPrice || undefined,
                maxPrice: filters.maxPrice || undefined,
                condition: filters.condition !== 'any' ? filters.condition : undefined,
            });
            if (result.success) {
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 2000);
            }
        });
    };

    const PriceSelector = () => (
        <div className="flex gap-2">
            <Select value={filters.minPrice} onValueChange={(val) => updateFilter('minPrice', val)}>
                <SelectTrigger className="w-full bg-white h-9">
                    <SelectValue placeholder="Min €" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="0">€0</SelectItem>
                    {activePricePoints.map((price, index) => (
                        <SelectItem key={`min-${price}`} value={price.toString()}>
                            €{price.toLocaleString()}
                            {index === activePricePoints.length - 1 ? "+" : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select value={filters.maxPrice} onValueChange={(val) => updateFilter('maxPrice', val)}>
                <SelectTrigger className="w-full bg-white h-9">
                    <SelectValue placeholder="Max €" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="0">Any Max</SelectItem>
                    {activePricePoints.map((price, index) => (
                        <SelectItem key={`max-${price}`} value={price.toString()}>
                            €{price.toLocaleString()}
                            {index === activePricePoints.length - 1 ? "+" : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );

    return (
        <>
            {/* Desktop Horizontal Bar - Sticky below header */}
            <div className="sticky top-[80px] z-30 w-full bg-white/95 backdrop-blur-md border-b shadow-sm transition-all hidden md:block">
                <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                    <div className="container mx-auto px-4 py-3">
                        <div className="flex items-center gap-3">
                            {/* 1. Status Logic */}
                            <div className="bg-gray-100 p-1 rounded-lg flex items-center shrink-0">
                                <button
                                    onClick={() => { updateFilter('status', 'sale'); handleSearch({ status: 'sale' }); }}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all",
                                        filters.status === 'sale'
                                            ? "bg-white shadow-sm text-black"
                                            : "text-gray-500 hover:text-gray-900"
                                    )}
                                >
                                    For Sale
                                </button>
                                <button
                                    onClick={() => { updateFilter('status', 'rent'); handleSearch({ status: 'rent' }); }}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all",
                                        filters.status === 'rent'
                                            ? "bg-white shadow-sm text-black"
                                            : "text-gray-500 hover:text-gray-900"
                                    )}
                                >
                                    For Rent
                                </button>
                            </div>

                            <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

                            {/* 2. Location */}
                            <div className="w-[180px] shrink-0">
                                <LocationFilter
                                    selectedDistricts={filters.locations}
                                    selectedAreas={filters.areas}
                                    onChange={(d, a) => setFilters(prev => ({ ...prev, locations: d, areas: a }))}
                                    triggerClassName="w-full h-9 border-transparent bg-transparent hover:bg-gray-100 shadow-none justify-between px-3"
                                />
                            </div>

                            {/* 3. Type */}
                            <div className="w-[140px] shrink-0">
                                <PropertyTypeFilter
                                    selectedCategories={filters.categories}
                                    selectedSubtypes={filters.types}
                                    onChange={(c, t) => setFilters(prev => ({ ...prev, categories: c, types: t }))}
                                    triggerClassName="w-full h-9 border-transparent bg-transparent hover:bg-gray-100 shadow-none justify-between px-3"
                                />
                            </div>

                            {/* 4. Price */}
                            <Popover open={priceOpen} onOpenChange={setPriceOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="ghost" className="h-9 w-[130px] justify-between px-3 font-normal text-muted-foreground hover:bg-gray-100 shrink-0">
                                        <span className="truncate">
                                            {(filters.minPrice || filters.maxPrice)
                                                ? `€${filters.minPrice || '0'} - ${filters.maxPrice ? '€' + filters.maxPrice : 'Any'}`
                                                : 'Price'}
                                        </span>
                                        <ChevronDown className="h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[300px] p-3" align="start">
                                    <div className="space-y-2">
                                        <h4 className="font-medium text-sm text-muted-foreground mb-2">Price Range</h4>
                                        <PriceSelector />
                                        <Button size="sm" className="w-full mt-2" onClick={() => setPriceOpen(false)}>Apply</Button>
                                    </div>
                                </PopoverContent>
                            </Popover>

                            {/* 5. Bedrooms */}
                            <div className="w-[110px] shrink-0">
                                <BedroomsFilter
                                    selectedBedrooms={filters.bedrooms}
                                    onChange={(b) => setFilters(prev => ({ ...prev, bedrooms: b }))}
                                    triggerClassName="w-full h-9 border-transparent bg-transparent hover:bg-gray-100 shadow-none justify-between px-3"
                                />
                            </div>

                            {/* Spacer */}
                            <div className="flex-1" />

                            {/* 6. Expand Toggle */}
                            <CollapsibleTrigger asChild>
                                <Button variant={isExpanded ? "secondary" : "outline"} size="sm" className={cn("h-9 gap-2 shrink-0 border-gray-200", isExpanded && "bg-gray-100")}>
                                    <SlidersHorizontal className="w-3.5 h-3.5" />
                                    <span className="hidden lg:inline">{isExpanded ? "Less Options" : "More Filters"}</span>
                                    {activeFiltersCount > 0 && !isExpanded && (
                                        <Badge variant="secondary" className="h-5 px-1.5 rounded-sm ml-1">{activeFiltersCount}</Badge>
                                    )}
                                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 opacity-50" /> : <ChevronDown className="w-3.5 h-3.5 opacity-50" />}
                                </Button>
                            </CollapsibleTrigger>

                            {/* 7. Search Button */}
                            <Button
                                size="sm"
                                onClick={() => handleSearch()}
                                className="h-9 w-9 p-0 shrink-0 shadow-sm hover:shadow-md transition-all active:scale-95"
                                style={{ backgroundColor: primaryColor }}
                            >
                                <Search className="w-4 h-4" />
                            </Button>
                        </div>

                        {/* Expanded Row */}
                        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                            <div className="pt-4 pb-2 mt-2 border-t border-dashed grid grid-cols-12 gap-4">

                                {/* Condition */}
                                <div className="col-span-3">
                                    <Select value={filters.condition} onValueChange={(val) => updateFilter('condition', val)}>
                                        <SelectTrigger className="w-full h-9 border-transparent bg-transparent hover:bg-gray-100 shadow-none px-3">
                                            <SelectValue placeholder="Condition" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="any">Any Condition</SelectItem>
                                            {PROPERTY_CONDITIONS.map(c => (
                                                <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Reference */}
                                <div className="col-span-3">
                                    <Input
                                        placeholder="Ref. No."
                                        value={filters.reference}
                                        onChange={(e) => updateFilter('reference', e.target.value)}
                                        className="w-full h-9 border-transparent bg-transparent hover:bg-gray-100 shadow-none px-3 focus-visible:ring-0 focus-visible:bg-gray-100 placeholder:text-muted-foreground"
                                    />
                                </div>

                                {/* Features (Wide) */}
                                <div className="col-span-6">
                                    <FeaturesFilter
                                        selectedFeatures={filters.features}
                                        onChange={(f) => updateFilter('features', f)}
                                        allowedFeatures={PUBLIC_FEATURES_LIST}
                                        triggerClassName="w-full h-9 border-transparent bg-transparent hover:bg-gray-100 shadow-none justify-between px-3 text-muted-foreground"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-between items-center pb-2">
                                <div className="flex items-center gap-2">
                                    {hasActiveFilters && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={handleSaveSearch}
                                            disabled={isSaving}
                                            className={cn(
                                                "text-xs h-8 gap-1.5",
                                                saveSuccess && "border-green-500 text-green-600"
                                            )}
                                        >
                                            {saveSuccess ? (
                                                <><Check className="h-3.5 w-3.5" /> Saved!</>
                                            ) : (
                                                <><Bookmark className="h-3.5 w-3.5" /> Save Search</>
                                            )}
                                        </Button>
                                    )}
                                </div>
                                <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-8 text-muted-foreground hover:text-red-600">
                                    Reset Filters
                                </Button>
                            </div>
                        </CollapsibleContent>
                    </div>
                </Collapsible>
            </div>

            {/* Mobile Bar - Sticky */}
            <div className="sticky top-[80px] z-30 w-full bg-white border-b shadow-sm md:hidden">
                <div className="px-4 py-3 flex gap-2">
                    <div className="flex-1 relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                        <Input
                            className="pl-9 h-10 w-full bg-gray-50 border-transparent focus:bg-white transition-colors"
                            placeholder="Search..."
                            readOnly
                            onClick={() => setIsMobileOpen(true)}
                        />
                    </div>
                    <Button
                        size="icon"
                        variant="outline"
                        className="h-10 w-10 shrink-0"
                        onClick={() => setIsMobileOpen(true)}
                    >
                        <SlidersHorizontal className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            {/* Full Mobile Filter Sheet */}
            <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                <SheetContent side="bottom" className="h-[95vh] rounded-t-2xl sm:max-w-none">
                    <SheetHeader className="text-left mb-6">
                        <SheetTitle>Filters</SheetTitle>
                    </SheetHeader>

                    <div className="h-full overflow-y-auto pb-24 space-y-6 px-1">

                        {/* Goal */}
                        <div className="space-y-2">
                            <Label>Goal</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    variant={filters.status === 'sale' ? 'default' : 'outline'}
                                    onClick={() => updateFilter('status', 'sale')}
                                    style={filters.status === 'sale' ? { backgroundColor: primaryColor } : {}}
                                >
                                    For Sale
                                </Button>
                                <Button
                                    variant={filters.status === 'rent' ? 'default' : 'outline'}
                                    onClick={() => updateFilter('status', 'rent')}
                                    style={filters.status === 'rent' ? { backgroundColor: primaryColor } : {}}
                                >
                                    For Rent
                                </Button>
                            </div>
                        </div>

                        {/* Location */}
                        <div className="space-y-2">
                            <Label>Location</Label>
                            <LocationFilter
                                modal
                                selectedDistricts={filters.locations}
                                selectedAreas={filters.areas}
                                onChange={(d, a) => setFilters(prev => ({ ...prev, locations: d, areas: a }))}
                                triggerClassName="w-full h-12"
                            />
                        </div>

                        {/* Type */}
                        <div className="space-y-2">
                            <Label>Type</Label>
                            <PropertyTypeFilter
                                modal
                                selectedCategories={filters.categories}
                                selectedSubtypes={filters.types}
                                onChange={(c, t) => setFilters(prev => ({ ...prev, categories: c, types: t }))}
                                triggerClassName="w-full h-12"
                            />
                        </div>

                        {/* Price */}
                        <div className="space-y-2">
                            <Label>Price Range</Label>
                            <PriceSelector />
                        </div>

                        {/* Beds */}
                        <div className="space-y-2">
                            <Label>Bedrooms</Label>
                            <BedroomsFilter
                                selectedBedrooms={filters.bedrooms}
                                onChange={(b) => setFilters(prev => ({ ...prev, bedrooms: b }))}
                                triggerClassName="w-full h-12"
                            />
                        </div>

                        <Separator />

                        {/* Ref */}
                        <div className="space-y-2">
                            <Label>Ref. No</Label>
                            <Input
                                placeholder="e.g. DT1234"
                                value={filters.reference}
                                onChange={(e) => updateFilter('reference', e.target.value)}
                                className="h-12"
                            />
                        </div>

                        {/* Features */}
                        <div className="space-y-2">
                            <Label>Features</Label>
                            <FeaturesFilter
                                selectedFeatures={filters.features}
                                onChange={(f) => updateFilter('features', f)}
                                allowedFeatures={PUBLIC_FEATURES_LIST}
                                triggerClassName="w-full h-12"
                            />
                        </div>

                        {/* Condition Mobile */}
                        <div className="space-y-2">
                            <Label>Condition</Label>
                            <Select value={filters.condition} onValueChange={(val) => updateFilter('condition', val)}>
                                <SelectTrigger className="w-full h-12">
                                    <SelectValue placeholder="Any Condition" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="any">Any Condition</SelectItem>
                                    {PROPERTY_CONDITIONS.map(c => (
                                        <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-white">
                        <div className="flex gap-2">
                            <Button variant="outline" className="flex-1 h-12" onClick={handleReset}>Reset</Button>
                            <Button className="flex-[2] h-12 font-bold" onClick={() => handleSearch()} style={{ backgroundColor: primaryColor }}>
                                Search {resultsCount ? `(${resultsCount})` : ''}
                            </Button>
                        </div>
                    </div>

                </SheetContent>
            </Sheet>
        </>
    );
}
