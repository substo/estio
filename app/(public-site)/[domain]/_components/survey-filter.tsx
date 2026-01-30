"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Search, MapPin, Home, Banknote, ArrowRight, ArrowLeft, Check, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PROPERTY_TYPES } from "@/lib/properties/constants";
import { PROPERTY_CONDITIONS, PUBLIC_FEATURES_LIST } from "@/lib/properties/filter-constants";
import { PropertyTypeFilter } from "@/components/properties/property-type-filter";
import { LocationFilter } from "@/components/properties/location-filter";
import { BedroomsFilter } from "@/components/properties/bedrooms-filter";
import { FeaturesFilter } from "@/components/properties/features-filter";

// Re-defining SearchParams locally for client usage
interface FilterParams {
    status?: string;
    location?: string; // Survey mode single location
    type?: string;     // Survey mode single type (category)
    categories?: string[];
    types?: string[];
    locations?: string[];
    areas?: string[];
    budget?: string;
    bedrooms?: string[];
    features?: string[];
    condition?: string;
}

interface SurveyFilterProps {
    locationId: string;
    primaryColor?: string;
    getFilterCountAction: (locationId: string, params: any) => Promise<number>;
}

const STEPS = [
    { id: 'goal', question: "What is your goal?" },
    { id: 'location', question: "Where are you looking?" },
    { id: 'type', question: "What type of property?" },
    { id: 'budget', question: "What is your budget?" },
];

const LOCATIONS = [
    { id: 'any', label: 'Any', fullLabel: 'Any Location' },
    { id: 'Limassol', label: 'Limassol' },
    { id: 'Paphos', label: 'Paphos' },
    { id: 'Nicosia', label: 'Nicosia' },
    { id: 'Larnaca', label: 'Larnaca' },
    { id: 'Famagusta', label: 'Famagusta' },
];

// Dynamically generate types from constants
const CATEGORY_BUTTONS = [
    { id: 'any', label: 'Any', fullLabel: 'Any Type' },
    ...PROPERTY_TYPES.map(cat => ({
        id: cat.category_key,
        label: cat.category_label,
        fullLabel: cat.category_label
    }))
];

const BUDGETS = [
    { id: 'any', label: 'Any', fullLabel: 'Any Budget', min: null, max: null },
    { id: 'low', label: '< 200k', min: null, max: 200000 },
    { id: 'mid', label: '200k-500k', min: 200000, max: 500000 },
    { id: 'high', label: '500k-1M', min: 500000, max: 1000000 },
    { id: 'luxury', label: '1M+', min: 1000000, max: null },
];

const RENT_BUDGETS = [
    { id: 'any', label: 'Any', fullLabel: 'Any Budget', min: null, max: null },
    { id: 'low', label: '< €1,000', min: null, max: 1000 },
    { id: 'mid', label: '€1,000 - €2,000', min: 1000, max: 2000 },
    { id: 'high', label: '€2,000 - €4,000', min: 2000, max: 4000 },
    { id: 'luxury', label: '€4,000+', min: 4000, max: null },
];

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

export function SurveyFilter({ locationId, primaryColor, getFilterCountAction }: SurveyFilterProps) {
    const router = useRouter();
    const [step, setStep] = useState(0);
    const [filters, setFilters] = useState<FilterParams>({ status: 'sale' });
    const [count, setCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [mode, setMode] = useState<'survey' | 'advanced'>('survey');

    // Fetch count
    useEffect(() => {
        let isMounted = true;
        const fetchCount = async () => {
            setLoading(true);
            try {
                // Ensure we pass array params correctly to the server action
                const params: any = { ...filters };

                // Map local 'type' usage in survey mode to 'categories'
                if (filters.type && filters.type !== 'any' && !filters.categories) {
                    params.categories = [filters.type];
                    delete params.type;
                }

                // Map local 'location' usage in survey mode to 'locations' (assuming District level)
                if (filters.location && filters.location !== 'any' && !filters.locations) {
                    params.locations = [filters.location];
                    delete params.location;
                }

                // Map 'budget' to minPrice/maxPrice
                if (filters.budget && filters.budget !== 'any') {
                    const activeBudgets = filters.status === 'rent' ? RENT_BUDGETS : BUDGETS;
                    const budgetObj = activeBudgets.find(b => b.id === filters.budget);
                    if (budgetObj) {
                        if (budgetObj.min) params.minPrice = budgetObj.min;
                        if (budgetObj.max) params.maxPrice = budgetObj.max;
                    }
                    delete params.budget;
                }

                const result = await getFilterCountAction(locationId, params);
                if (isMounted) setCount(result);
            } catch (error) {
                console.error("Failed to fetch count", error);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        const timer = setTimeout(fetchCount, 300);
        return () => { isMounted = false; clearTimeout(timer); };
    }, [filters, locationId, getFilterCountAction]);

    const handleSelect = (key: keyof FilterParams, value: string) => {
        setFilters(prev => ({ ...prev, [key]: value }));
        // Auto-advance
        if (step < STEPS.length - 1) {
            setTimeout(() => setStep(step + 1), 250);
        }
    };

    const handleBack = () => {
        if (step > 0) setStep(step - 1);
    };

    const handleSearch = () => {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);

        // Survey mode 'location'
        if (filters.location && filters.location !== 'any') {
            params.set('locations', filters.location);
        }

        // Advanced mode locations
        if (filters.locations && filters.locations.length > 0) {
            params.set('locations', filters.locations.join(','));
        }
        if (filters.areas && filters.areas.length > 0) {
            params.set('areas', filters.areas.join(','));
        }

        // Survey mode 'type'
        if (filters.type && filters.type !== 'any') {
            params.set('categories', filters.type);
        }

        // Advanced mode types
        if (filters.categories && filters.categories.length > 0) {
            params.set('categories', filters.categories.join(','));
        }
        if (filters.types && filters.types.length > 0) {
            params.set('types', filters.types.join(','));
        }

        // Advanced mode bedrooms
        if (filters.bedrooms && filters.bedrooms.length > 0) {
            params.set('bedrooms', filters.bedrooms.join(','));
        }

        // Advanced mode features
        if (filters.features && filters.features.length > 0) {
            params.set('features', filters.features.join(','));
        }

        if (filters.condition && filters.condition !== 'any') {
            params.set('condition', filters.condition);
        }

        if (filters.budget && filters.budget !== 'any') {
            const activeBudgets = filters.status === 'rent' ? RENT_BUDGETS : BUDGETS;
            const budgetObj = activeBudgets.find(b => b.id === filters.budget);
            if (budgetObj) {
                if (budgetObj.min) params.set('min_price', budgetObj.min.toString());
                if (budgetObj.max) params.set('max_price', budgetObj.max.toString());
            }
        }

        router.push(`/properties/search?${params.toString()}`);
    };

    // Advanced search submission
    const handleAdvancedSearch = (e: React.FormEvent) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const formData = new FormData(form);
        const params = new URLSearchParams();

        // Map form data to URL params
        const status = formData.get('status') as string;
        const minPrice = formData.get('minPrice') as string;
        const maxPrice = formData.get('maxPrice') as string;
        const reference = formData.get('reference') as string;

        if (status) params.set('status', status);
        if (reference) params.set('reference', reference);

        // Use state for locations/areas
        if (filters.locations && filters.locations.length > 0) {
            params.set('locations', filters.locations.join(','));
        }
        if (filters.areas && filters.areas.length > 0) {
            params.set('areas', filters.areas.join(','));
        }

        // Use state for categories/types
        if (filters.categories && filters.categories.length > 0) {
            params.set('categories', filters.categories.join(','));
        }
        if (filters.types && filters.types.length > 0) {
            params.set('types', filters.types.join(','));
        }

        // Use state for bedrooms
        if (filters.bedrooms && filters.bedrooms.length > 0) {
            params.set('bedrooms', filters.bedrooms.join(','));
        }

        // Use state for features
        if (filters.features && filters.features.length > 0) {
            params.set('features', filters.features.join(','));
        }

        // Use state/form for condition
        if (filters.condition && filters.condition !== 'any') {
            params.set('condition', filters.condition);
        }

        const maxLimit = status === 'rent' ? 10000 : 10000000;

        if (minPrice && minPrice !== '0') params.set('min_price', minPrice);
        if (maxPrice && maxPrice !== '0') {
            // If the selected max price is the highest option, treat it as "unlimited" (no max param)
            if (parseInt(maxPrice) < maxLimit) {
                params.set('max_price', maxPrice);
            }
        }

        router.push(`/properties/search?${params.toString()}`);
    };

    // Determine container width/style based on content
    const isGoalStep = step === 0 && mode === 'survey';
    const isAdvanced = mode === 'advanced';
    const activePricePoints = filters.status === 'rent' ? RENT_PRICE_POINTS : PRICE_POINTS;
    const activeBudgets = filters.status === 'rent' ? RENT_BUDGETS : BUDGETS;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
                layout: { type: "spring", bounce: 0.2, duration: 0.6 },
                opacity: { duration: 0.8, delay: 0.4 },
                y: { duration: 0.8, delay: 0.4 }
            }}
            className={cn(
                "mx-auto overflow-hidden relative z-20",
                "bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl",
                isAdvanced ? "w-full max-w-5xl rounded-lg" :
                    isGoalStep ? "w-fit rounded-lg" : "w-full max-w-3xl rounded-lg"
            )}
        >
            <AnimatePresence mode="wait">
                {mode === 'survey' ? (
                    <motion.div
                        key="survey-container"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={cn(
                            "flex flex-col items-center justify-center p-2",
                            // Add minimum width for the first step to ensure it doesn't look too squashed if we reduce roundness
                            isGoalStep && "min-w-[300px]"
                        )}
                    >
                        {/* Header / Question */}
                        <motion.h3
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-xl md:text-2xl font-heading font-bold text-white mb-6 mt-4 text-center drop-shadow-md"
                        >
                            {STEPS[step].question}
                        </motion.h3>

                        <div className="w-full">
                            <AnimatePresence mode="wait">
                                {step === 0 && (
                                    <motion.div
                                        key="step-goal"
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.9 }}
                                        className="flex gap-2 p-1 justify-center"
                                    >
                                        <motion.button
                                            onClick={() => handleSelect('status', 'sale')}
                                            animate={{
                                                scale: [1, 1.03, 1],
                                                boxShadow: [
                                                    "0px 0px 0px rgba(255,255,255,0)",
                                                    "0px 0px 10px rgba(255,255,255,0.3)",
                                                    "0px 0px 0px rgba(255,255,255,0)"
                                                ]
                                            }}
                                            transition={{
                                                duration: 3,
                                                repeat: Infinity,
                                                repeatType: "reverse",
                                                ease: "easeInOut"
                                            }}
                                            className={cn(
                                                "px-8 py-3 rounded-md text-lg font-medium transition-all hover:bg-white/20 active:scale-95",
                                                filters.status === 'sale' ? "text-white shadow-lg" : "text-white"
                                            )}
                                            style={{
                                                backgroundColor: filters.status === 'sale' ? (primaryColor || 'black') : 'transparent'
                                            }}
                                        >
                                            Buy
                                        </motion.button>
                                        <motion.button
                                            onClick={() => handleSelect('status', 'rent')}
                                            animate={{
                                                scale: [1, 1.03, 1],
                                                boxShadow: [
                                                    "0px 0px 0px rgba(255,255,255,0)",
                                                    "0px 0px 10px rgba(255,255,255,0.3)",
                                                    "0px 0px 0px rgba(255,255,255,0)"
                                                ]
                                            }}
                                            transition={{
                                                duration: 3,
                                                repeat: Infinity,
                                                repeatType: "reverse",
                                                ease: "easeInOut",
                                                delay: 0.5 // Stagger the breathing slightly
                                            }}
                                            className={cn(
                                                "px-8 py-3 rounded-md text-lg font-medium transition-all hover:bg-white/20 active:scale-95",
                                                filters.status === 'rent' ? "text-white shadow-lg" : "text-white"
                                            )}
                                            style={{
                                                backgroundColor: filters.status === 'rent' ? (primaryColor || 'black') : 'transparent'
                                            }}
                                        >
                                            Rent
                                        </motion.button>
                                    </motion.div>
                                )}

                                {step === 1 && (
                                    <motion.div
                                        key="step-location"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -20 }}
                                        className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full px-6 pb-6"
                                    >
                                        {LOCATIONS.map(loc => (
                                            <button
                                                key={loc.id}
                                                onClick={() => handleSelect('location', loc.id)}
                                                className={cn(
                                                    "h-14 rounded-md flex items-center justify-center font-medium transition-all duration-200 hover:scale-[1.02] active:scale-95 text-sm md:text-base",
                                                    filters.location === loc.id
                                                        ? "text-white shadow-lg"
                                                        : "bg-white/10 text-white hover:bg-white/20 border border-white/10"
                                                )}
                                                style={{
                                                    backgroundColor: filters.location === loc.id ? (primaryColor || 'black') : undefined
                                                }}
                                            >
                                                {loc.fullLabel || loc.label}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}

                                {step === 2 && (
                                    <motion.div
                                        key="step-type"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -20 }}
                                        className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full px-6 pb-6"
                                    >
                                        {CATEGORY_BUTTONS.map(t => (
                                            <button
                                                key={t.id}
                                                onClick={() => handleSelect('type', t.id)}
                                                className={cn(
                                                    "h-14 rounded-md flex items-center justify-center font-medium transition-all duration-200 hover:scale-[1.02] active:scale-95 text-sm md:text-base",
                                                    filters.type === t.id
                                                        ? "text-white shadow-lg"
                                                        : "bg-white/10 text-white hover:bg-white/20 border border-white/10"
                                                )}
                                                style={{
                                                    backgroundColor: filters.type === t.id ? (primaryColor || 'black') : undefined
                                                }}
                                            >
                                                {t.fullLabel || t.label}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}

                                {step === 3 && (
                                    <motion.div
                                        key="step-budget"
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -20 }}
                                        className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full px-6 pb-6"
                                    >
                                        {activeBudgets.map(b => (
                                            <button
                                                key={b.id}
                                                onClick={() => handleSelect('budget', b.id)}
                                                className={cn(
                                                    "h-14 rounded-md flex items-center justify-center font-medium transition-all duration-200 hover:scale-[1.02] active:scale-95 text-sm md:text-base",
                                                    filters.budget === b.id
                                                        ? "text-white shadow-lg"
                                                        : "bg-white/10 text-white hover:bg-white/20 border border-white/10"
                                                )}
                                                style={{
                                                    backgroundColor: filters.budget === b.id ? (primaryColor || 'black') : undefined
                                                }}
                                            >
                                                {b.fullLabel || b.label}
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Footer Controls */}
                        <div className={cn("w-full flex items-center px-6 pb-4 md:px-8", step === 0 ? "justify-center" : "justify-between")}>
                            <div className="flex gap-2">
                                {(step > 0) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleBack}
                                        className="text-white/60 hover:text-white hover:bg-white/10"
                                    >
                                        <ArrowLeft className="mr-1 h-3 w-3" /> Back
                                    </Button>
                                )}

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setMode('advanced')}
                                    className="text-white/60 hover:text-white hover:bg-white/10"
                                >
                                    <SlidersHorizontal className="mr-1 h-3 w-3" /> Advanced
                                </Button>
                            </div>

                            {/* Show Properties Button (Visible on last step or if user wants to skip) */}
                            {step === 3 && (
                                <Button
                                    onClick={handleSearch}
                                    className="text-white hover:opacity-90 rounded-md px-6 shadow-xl transition-all hover:scale-105"
                                    style={{ backgroundColor: primaryColor || 'black' }}
                                >
                                    {loading ? (
                                        <span className="animate-pulse">Counting...</span>
                                    ) : (
                                        <>
                                            Show {count !== null ? count : '...'} Homes
                                        </>
                                    )}
                                    <ArrowRight className="ml-2 h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="advanced-container"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="p-6 w-full"
                    >
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white">Advanced Search</h3>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setMode('survey')}
                                className="text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                            >
                                <X className="h-5 w-5" />
                            </Button>
                        </div>

                        <form onSubmit={handleAdvancedSearch} className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {/* Replicating the full filter capability in a clean grid */}
                            <div className="space-y-2">
                                <Label className="text-white/80">Goal</Label>
                                <Select name="status" onValueChange={(val) => handleSelect('status', val)} defaultValue={filters.status}>
                                    <SelectTrigger className="w-full h-10 rounded-md bg-white/10 border-white/20 text-white focus:ring-white/50">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="sale">For Sale</SelectItem>
                                        <SelectItem value="rent">For Rent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label className="text-white/80">Location</Label>
                                <LocationFilter
                                    selectedDistricts={filters.locations || []}
                                    selectedAreas={filters.areas || []}
                                    onChange={(districts, areas) => {
                                        setFilters(prev => ({ ...prev, locations: districts, areas }));
                                    }}
                                    triggerClassName="bg-white/10 border-white/20 text-white hover:bg-white/20"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-white/80">Type</Label>
                                <PropertyTypeFilter
                                    selectedCategories={filters.categories || []}
                                    selectedSubtypes={filters.types || []}
                                    onChange={(categories, types) => {
                                        setFilters(prev => ({ ...prev, categories, types }));
                                    }}
                                    triggerClassName="bg-white/10 border-white/20 text-white hover:bg-white/20"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-white/80">Bedrooms</Label>
                                <BedroomsFilter
                                    selectedBedrooms={filters.bedrooms || []}
                                    onChange={(bedrooms) => setFilters(prev => ({ ...prev, bedrooms }))}
                                    triggerClassName="bg-white/10 border-white/20 text-white hover:bg-white/20"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-white/80">Features</Label>
                                <FeaturesFilter
                                    selectedFeatures={filters.features || []}
                                    onChange={(features) => setFilters(prev => ({ ...prev, features }))}
                                    triggerClassName="bg-white/10 border-white/20 text-white hover:bg-white/20"
                                    allowedFeatures={PUBLIC_FEATURES_LIST}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label className="text-white/80">Condition</Label>
                                <Select
                                    name="condition"
                                    onValueChange={(val) => setFilters(prev => ({ ...prev, condition: val }))}
                                    defaultValue={filters.condition}
                                >
                                    <SelectTrigger className="w-full h-10 rounded-md bg-white/10 border-white/20 text-white focus:ring-white/50">
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

                            <div className="space-y-2">
                                <Label className="text-white/80">Price Range</Label>
                                <div className="flex gap-2">
                                    <Select name="minPrice">
                                        <SelectTrigger className="w-full h-10 rounded-md bg-white/10 border-white/20 text-white focus:ring-white/50">
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

                                    <Select name="maxPrice">
                                        <SelectTrigger className="w-full h-10 rounded-md bg-white/10 border-white/20 text-white focus:ring-white/50">
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

                            <div className="space-y-2">
                                <Label className="text-white/80">Ref. No.</Label>
                                <Input
                                    name="reference"
                                    placeholder="e.g. DT1234"
                                    className="w-full h-10 rounded-md bg-white/10 border-white/20 text-white focus:ring-white/50 placeholder:text-white/40"
                                />
                            </div>

                            <div className="md:col-span-3 lg:col-span-1 pt-6 md:pt-8 lg:pt-0 flex items-end">
                                <Button type="submit" className="w-full bg-white text-black hover:bg-white/90 font-bold shadow-lg">
                                    Search Properties
                                </Button>
                            </div>
                        </form>
                    </motion.div>
                )
                }
            </AnimatePresence >
        </motion.div >
    );
}
