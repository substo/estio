'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { PROPERTY_TYPES } from '@/lib/properties/constants';
import { PRICE_RANGES, FEATURE_CATEGORIES, PROPERTY_CONDITIONS, PROPERTY_SOURCES, PROPERTY_FILTERS } from '@/lib/properties/filter-constants';
import { PropertyTypeFilter } from './property-type-filter';
import { LocationFilter } from './location-filter';
import { BedroomsFilter } from './bedrooms-filter';
import { FeaturesFilter } from './features-filter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, X, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';

interface PropertyFiltersProps {
    owners?: string[];
}

export function PropertyFilters({ owners = [] }: PropertyFiltersProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    // Local state for inputs to avoid excessive URL updates
    const [search, setSearch] = useState(searchParams.get('q') || '');
    const [ownerOpen, setOwnerOpen] = useState(false);
    const [minPrice, setMinPrice] = useState(searchParams.get('min_price') || '');
    const [maxPrice, setMaxPrice] = useState(searchParams.get('max_price') || '');
    const [reference, setReference] = useState(searchParams.get('reference') || '');
    const [isExpanded, setIsExpanded] = useState(false);

    const createQueryString = useCallback(
        (name: string, value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            if (value) {
                params.set(name, value);
            } else {
                params.delete(name);
            }
            // Reset pagination when filtering
            params.delete('skip');
            return params.toString();
        },
        [searchParams]
    );

    const handleFilterChange = (name: string, value: string) => {
        router.push(`?${createQueryString(name, value)}`);
    };

    // Parse categories and types from URL
    const selectedCategories = searchParams.get('categories')
        ? searchParams.get('categories')!.split(',')
        : (searchParams.get('category') ? [searchParams.get('category')!] : []);

    const selectedSubtypes = searchParams.get('types')
        ? searchParams.get('types')!.split(',')
        : (searchParams.get('subtype') ? [searchParams.get('subtype')!] : []);

    const selectedFeatures = searchParams.get('features')
        ? searchParams.get('features')!.split(',')
        : [];

    const handleFeatureToggle = (featureKey: string) => {
        const current = new Set(selectedFeatures);
        if (current.has(featureKey)) {
            current.delete(featureKey);
        } else {
            current.add(featureKey);
        }

        const params = new URLSearchParams(searchParams.toString());
        if (current.size > 0) {
            params.set('features', Array.from(current).join(','));
        } else {
            params.delete('features');
        }
        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    const handlePriceRangeChange = (rangeKey: string) => {
        const params = new URLSearchParams(searchParams.toString());

        if (rangeKey === 'all') {
            params.delete('min_price');
            params.delete('max_price');
        } else {
            const range = PRICE_RANGES.find(r => r.key === rangeKey);
            if (range) {
                if (range.min_price_eur !== null) params.set('min_price', range.min_price_eur.toString());
                else params.delete('min_price');

                if (range.max_price_eur !== null) params.set('max_price', range.max_price_eur.toString());
                else params.delete('max_price');
            }
        }

        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    // Determine current price range key based on min/max params
    const currentMin = searchParams.get('min_price') ? parseInt(searchParams.get('min_price')!) : null;
    const currentMax = searchParams.get('max_price') ? parseInt(searchParams.get('max_price')!) : null;

    const currentPriceRange = PRICE_RANGES.find(r =>
        r.min_price_eur === currentMin && r.max_price_eur === currentMax
    )?.key || 'all';

    const handleTypeChange = (categories: string[], subtypes: string[]) => {
        const params = new URLSearchParams(searchParams.toString());

        if (categories.length > 0) {
            params.set('categories', categories.join(','));
        } else {
            params.delete('categories');
        }

        if (subtypes.length > 0) {
            params.set('types', subtypes.join(','));
        } else {
            params.delete('types');
        }

        // Clear legacy params
        params.delete('category');
        params.delete('subtype');

        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    const selectedDistricts = searchParams.get('locations')
        ? searchParams.get('locations')!.split(',')
        : (searchParams.get('location') ? [searchParams.get('location')!] : []);

    const selectedAreas = searchParams.get('areas')
        ? searchParams.get('areas')!.split(',')
        : [];

    const handleLocationChange = (districts: string[], areas: string[]) => {
        const params = new URLSearchParams(searchParams.toString());

        if (districts.length > 0) {
            params.set('locations', districts.join(','));
        } else {
            params.delete('locations');
        }

        if (areas.length > 0) {
            params.set('areas', areas.join(','));
        } else {
            params.delete('areas');
        }

        // Clear legacy params
        params.delete('location');
        params.delete('district');

        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    const selectedBedrooms = searchParams.get('bedrooms')
        ? searchParams.get('bedrooms')!.split(',')
        : (searchParams.get('min_bedrooms') ? [searchParams.get('min_bedrooms')!] : []);

    const handleBedroomsChange = (bedrooms: string[]) => {
        const params = new URLSearchParams(searchParams.toString());

        if (bedrooms.length > 0) {
            params.set('bedrooms', bedrooms.join(','));
        } else {
            params.delete('bedrooms');
        }

        // Clear legacy param
        params.delete('min_bedrooms');

        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    const handleSearch = () => {
        const params = new URLSearchParams(searchParams.toString());
        if (search) params.set('q', search);
        else params.delete('q');

        if (minPrice) params.set('min_price', minPrice);
        // else params.delete('min_price'); // Don't delete if not set in state, as we might rely on range

        if (maxPrice) params.set('max_price', maxPrice);
        // else params.delete('max_price');

        if (reference) params.set('reference', reference);
        else params.delete('reference');

        params.delete('skip');
        router.push(`?${params.toString()}`);
    };

    const handleReset = () => {
        setSearch('');
        // setMinPrice('');
        // setMaxPrice('');
        setReference('');
        router.push(pathname);
        setIsExpanded(false);
    };

    const selectedOwner = searchParams.get('owner');

    const activeFilterCount = [
        searchParams.get('publicationStatus'),
        searchParams.get('status'),
        searchParams.get('goal'),
        searchParams.get('location'),
        searchParams.get('condition'),
        searchParams.get('min_bedrooms'),
        searchParams.get('bedrooms'),
        searchParams.get('owner'),
        searchParams.get('filterBy'),
        searchParams.get('source'),
        searchParams.get('categories'),
        searchParams.get('locations'),
        searchParams.get('areas'),
        searchParams.get('types'),
        searchParams.get('reference')
    ].filter(Boolean).length + (selectedFeatures.length > 0 ? 1 : 0);

    return (
        <Card className="mb-6">
            <CardContent className="pt-6">
                <div className="space-y-4">
                    {/* Primary Filters (Row 1) */}
                    <div className="flex gap-4 items-start w-full">
                        {/* Left Column: Filters & Search */}
                        <div className="flex-1 flex flex-wrap gap-2 items-center">
                            {/* All Properties (Publication Status) */}
                            <div className="w-[140px]">
                                <Select
                                    value={searchParams.get('publicationStatus') || ''}
                                    onValueChange={(val) => handleFilterChange('publicationStatus', val === 'all' ? '' : val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="All Properties" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Properties</SelectItem>
                                        <SelectItem value="Published">Published</SelectItem>
                                        <SelectItem value="Pending">Pending</SelectItem>
                                        <SelectItem value="Draft">Draft</SelectItem>
                                        <SelectItem value="Unlisted">Unlisted</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Status */}
                            <div className="w-[140px]">
                                <Select
                                    value={searchParams.get('status') || ''}
                                    onValueChange={(val) => handleFilterChange('status', val === 'all' ? '' : val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="Active">Active</SelectItem>
                                        <SelectItem value="Reserved">Reserved</SelectItem>
                                        <SelectItem value="Sold">Sold</SelectItem>
                                        <SelectItem value="Rented">Rented</SelectItem>
                                        <SelectItem value="Withdrawn">Withdrawn</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Goal */}
                            <div className="w-[140px]">
                                <Select
                                    value={searchParams.get('goal') || ''}
                                    onValueChange={(val) => handleFilterChange('goal', val === 'all' ? '' : val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Goal" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Goals</SelectItem>
                                        <SelectItem value="For Sale">For Sale</SelectItem>
                                        <SelectItem value="For Rent">For Rent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Property Type */}
                            <div className="w-[180px]">
                                <PropertyTypeFilter
                                    selectedCategories={selectedCategories}
                                    selectedSubtypes={selectedSubtypes}
                                    onChange={handleTypeChange}
                                />
                            </div>

                            {/* Location */}
                            <div className="w-[180px]">
                                <LocationFilter
                                    selectedDistricts={selectedDistricts}
                                    selectedAreas={selectedAreas}
                                    onChange={handleLocationChange}
                                />
                            </div>

                            {/* Condition */}
                            <div className="w-[140px]">
                                <Select
                                    value={searchParams.get('condition') || ''}
                                    onValueChange={(val) => handleFilterChange('condition', val === 'all' ? '' : val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Condition" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Any Condition</SelectItem>
                                        {PROPERTY_CONDITIONS.map((c) => (
                                            <SelectItem key={c.key} value={c.key}>
                                                {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Bedrooms */}
                            <div className="w-[140px]">
                                <BedroomsFilter
                                    selectedBedrooms={selectedBedrooms}
                                    onChange={handleBedroomsChange}
                                />
                            </div>

                            {/* Price Range */}
                            <div className="w-[140px]">
                                <Select
                                    value={currentPriceRange === 'all' ? '' : currentPriceRange}
                                    onValueChange={handlePriceRangeChange}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Price" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Any Price</SelectItem>
                                        {PRICE_RANGES.map((range) => (
                                            <SelectItem key={range.key} value={range.key}>
                                                {range.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Search */}
                            <div className="flex-1 min-w-[200px]">
                                <Input
                                    placeholder="Search by reference..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    className="w-full"
                                />
                            </div>
                        </div>

                        {/* Right Column: Actions */}
                        <div className="flex shrink-0 gap-2 items-center">
                            {/* More Filters Toggle */}
                            <Button
                                variant={isExpanded || activeFilterCount > 0 ? "secondary" : "outline"}
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="gap-2"
                                title="More Filters"
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                {activeFilterCount > 0 && (
                                    <Badge variant="default" className="h-5 w-5 p-0 flex items-center justify-center rounded-full text-xs">
                                        {activeFilterCount}
                                    </Badge>
                                )}
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>

                            {(activeFilterCount > 0 || search || currentPriceRange !== 'all') && (
                                <Button onClick={handleReset} variant="ghost" size="icon" title="Reset Filters">
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Expandable Secondary Filters */}
                    {isExpanded && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t animate-in fade-in slide-in-from-top-2">

                            {/* Features Filter */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Features</label>
                                <FeaturesFilter
                                    selectedFeatures={selectedFeatures}
                                    onChange={(features) => {
                                        const params = new URLSearchParams(searchParams.toString());
                                        if (features.length > 0) {
                                            params.set('features', features.join(','));
                                        } else {
                                            params.delete('features');
                                        }
                                        params.delete('skip');
                                        router.push(`?${params.toString()}`);
                                    }}
                                />
                            </div>

                            {/* Owner Filter */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Owner</label>
                                <Popover open={ownerOpen} onOpenChange={setOwnerOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            role="combobox"
                                            aria-expanded={ownerOpen}
                                            className="w-full justify-between"
                                        >
                                            {selectedOwner
                                                ? owners.find((owner) => owner === selectedOwner) || selectedOwner
                                                : "Select owner..."}
                                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-full p-0">
                                        <Command>
                                            <CommandInput placeholder="Search owner..." />
                                            <CommandList>
                                                <CommandEmpty>No owner found.</CommandEmpty>
                                                <CommandGroup>
                                                    <CommandItem
                                                        value="all_owners_reset_option"
                                                        onSelect={() => {
                                                            handleFilterChange('owner', '');
                                                            setOwnerOpen(false);
                                                        }}
                                                    >
                                                        <Check
                                                            className={cn(
                                                                "mr-2 h-4 w-4",
                                                                !selectedOwner ? "opacity-100" : "opacity-0"
                                                            )}
                                                        />
                                                        Any Owner
                                                    </CommandItem>
                                                    {owners.map((owner) => (
                                                        <CommandItem
                                                            key={owner}
                                                            value={owner}
                                                            onSelect={(currentValue) => {
                                                                handleFilterChange('owner', currentValue === selectedOwner ? '' : currentValue);
                                                                setOwnerOpen(false);
                                                            }}
                                                        >
                                                            <Check
                                                                className={cn(
                                                                    "mr-2 h-4 w-4",
                                                                    selectedOwner === owner ? "opacity-100" : "opacity-0"
                                                                )}
                                                            />
                                                            {owner}
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            </CommandList>
                                        </Command>
                                    </PopoverContent>
                                </Popover>
                            </div>

                            {/* Filter By */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Filter By</label>
                                <Select
                                    value={searchParams.get('filterBy') || 'all'}
                                    onValueChange={(val) => handleFilterChange('filterBy', val === 'all' ? '' : val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Filter by" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Filter by</SelectItem>
                                        {PROPERTY_FILTERS.map((f) => (
                                            <SelectItem key={f.key} value={f.key}>
                                                {f.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Created By */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Created By</label>
                                <Select
                                    value={searchParams.get('source') || 'all'}
                                    onValueChange={(val) => handleFilterChange('source', val === 'all' ? '' : val)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Any Source" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Any Source</SelectItem>
                                        {PROPERTY_SOURCES.map((s) => (
                                            <SelectItem key={s.key} value={s.key}>
                                                {s.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Ref. No. */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Ref. No.</label>
                                <Input
                                    placeholder="e.g. REF-001"
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                    className="w-full"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
