"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, RotateCcw, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PROPERTY_CONDITIONS, PUBLIC_FEATURES_LIST } from "@/lib/properties/filter-constants";
import { PropertyTypeFilter } from "@/components/properties/property-type-filter";
import { LocationFilter } from "@/components/properties/location-filter";
import { BedroomsFilter } from "@/components/properties/bedrooms-filter";
import { FeaturesFilter } from "@/components/properties/features-filter";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";


interface SearchFiltersProps {
    primaryColor?: string;
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

export function SearchFilters({ primaryColor }: SearchFiltersProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isOpen, setIsOpen] = useState(true);

    // Initial state from URL
    const initialStatus = searchParams.get('status') || 'sale';
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

    // Update specific filter
    const updateFilter = (key: string, value: any) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    // Apply filters to URL
    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams();

        if (filters.status) params.set('status', filters.status);
        if (filters.reference) params.set('reference', filters.reference);

        if (filters.locations.length > 0) params.set('locations', filters.locations.join(','));
        if (filters.areas.length > 0) params.set('areas', filters.areas.join(','));
        if (filters.categories.length > 0) params.set('categories', filters.categories.join(','));
        if (filters.types.length > 0) params.set('types', filters.types.join(','));
        if (filters.bedrooms.length > 0) params.set('bedrooms', filters.bedrooms.join(','));
        if (filters.features.length > 0) params.set('features', filters.features.join(','));
        if (filters.condition && filters.condition !== 'any') params.set('condition', filters.condition);

        if (filters.minPrice && filters.minPrice !== '0') params.set('min_price', filters.minPrice);
        if (filters.maxPrice && filters.maxPrice !== '0') {
            const maxLimit = filters.status === 'rent' ? 10000 : 10000000;
            if (parseInt(filters.maxPrice) < maxLimit) {
                params.set('max_price', filters.maxPrice);
            }
        }

        router.push(`/properties/search?${params.toString()}`);
    };

    // Reset filters
    const handleReset = () => {
        setFilters({
            status: 'sale',
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

    return (
        <Card className="border shadow-sm">
            <CardHeader className="py-4 px-6 bg-gray-50/50 border-b">
                <div className="flex items-center justify-between">
                    <div
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center gap-2 cursor-pointer group select-none"
                    >
                        <div className="p-1.5 bg-white border rounded shadow-sm group-hover:bg-gray-50 transition-colors">
                            <Filter className="w-4 h-4 text-gray-500" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Filter Properties</CardTitle>
                            <p className="text-xs text-muted-foreground">{isOpen ? 'Hide filters' : 'Show filters'}</p>
                        </div>
                    </div>

                    {isOpen && (
                        <Button type="button" variant="ghost" size="sm" onClick={handleReset} className="text-muted-foreground hover:text-foreground">
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Reset
                        </Button>
                    )}
                </div>
            </CardHeader>

            <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                <CollapsibleContent>
                    <CardContent className="p-6">
                        <form onSubmit={handleSearch} className="space-y-6">

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Goal */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Goal</Label>
                                    <Select
                                        value={filters.status}
                                        onValueChange={(val) => updateFilter('status', val)}
                                    >
                                        <SelectTrigger className="w-full bg-white">
                                            <SelectValue placeholder="Status" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="sale">For Sale</SelectItem>
                                            <SelectItem value="rent">For Rent</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Location */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location</Label>
                                    <LocationFilter
                                        selectedDistricts={filters.locations}
                                        selectedAreas={filters.areas}
                                        onChange={(districts, areas) => {
                                            setFilters(prev => ({ ...prev, locations: districts, areas }));
                                        }}
                                        triggerClassName="w-full h-10 bg-white border-input"
                                    />
                                </div>

                                {/* Property Type */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Property Type</Label>
                                    <PropertyTypeFilter
                                        selectedCategories={filters.categories}
                                        selectedSubtypes={filters.types}
                                        onChange={(categories, types) => {
                                            setFilters(prev => ({ ...prev, categories, types }));
                                        }}
                                        triggerClassName="w-full h-10 bg-white border-input"
                                    />
                                </div>

                                {/* Price Range */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Price Range</Label>
                                    <div className="flex gap-2">
                                        <Select value={filters.minPrice} onValueChange={(val) => updateFilter('minPrice', val)}>
                                            <SelectTrigger className="w-full bg-white">
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
                                            <SelectTrigger className="w-full bg-white">
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
                                </div>

                                {/* Bedrooms */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bedrooms</Label>
                                    <BedroomsFilter
                                        selectedBedrooms={filters.bedrooms}
                                        onChange={(bedrooms) => updateFilter('bedrooms', bedrooms)}
                                        triggerClassName="w-full h-10 bg-white border-input text-foreground"
                                    />
                                </div>

                                {/* Condition */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Condition</Label>
                                    <Select
                                        value={filters.condition}
                                        onValueChange={(val) => updateFilter('condition', val)}
                                    >
                                        <SelectTrigger className="w-full bg-white">
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

                                {/* Features - Spanning 2 columns if needed, or keep unified grid */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Features</Label>
                                    <FeaturesFilter
                                        selectedFeatures={filters.features}
                                        onChange={(features) => updateFilter('features', features)}
                                        triggerClassName="w-full h-10 bg-white border-input text-foreground"
                                        allowedFeatures={PUBLIC_FEATURES_LIST}
                                    />
                                </div>

                                {/* Reference Number */}
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ref. No.</Label>
                                    <Input
                                        placeholder="e.g. DT1234"
                                        value={filters.reference}
                                        onChange={(e) => updateFilter('reference', e.target.value)}
                                        className="bg-white"
                                    />
                                </div>
                            </div>

                            <Separator />

                            <div className="flex justify-end">
                                <Button
                                    type="submit"
                                    size="lg"
                                    className="px-8 font-semibold shadow-md transition-all hover:scale-[1.02]"
                                    style={{ backgroundColor: primaryColor || 'black' }}
                                >
                                    <Search className="w-4 h-4 mr-2" />
                                    Search Properties
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </CollapsibleContent>
            </Collapsible>
        </Card>
    );
}
