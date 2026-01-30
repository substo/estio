"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { FEATURE_CATEGORIES } from "@/lib/properties/filter-constants";

interface FeaturesFilterProps {
    selectedFeatures: string[];
    onChange: (features: string[]) => void;
    triggerClassName?: string;
    contentClassName?: string;
    allowedFeatures?: string[];
}

export function FeaturesFilter({
    selectedFeatures,
    onChange,
    triggerClassName,
    contentClassName,
    allowedFeatures,
}: FeaturesFilterProps) {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");
    const [openCategories, setOpenCategories] = React.useState<Record<string, boolean>>({});

    const handleFeatureToggle = (featureKey: string) => {
        const current = new Set(selectedFeatures);
        if (current.has(featureKey)) {
            current.delete(featureKey);
        } else {
            current.add(featureKey);
        }
        onChange(Array.from(current));
    };

    const toggleCategory = (label: string) => {
        setOpenCategories(prev => ({
            ...prev,
            [label]: !prev[label]
        }));
    };

    const isSearching = search.length > 0;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("w-full justify-between", triggerClassName)}
                >
                    {selectedFeatures.length > 0
                        ? `${selectedFeatures.length} selected`
                        : "Select features"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className={cn("w-full p-0", contentClassName || "w-[260px]")}>
                <Command shouldFilter={true}>
                    <CommandInput
                        placeholder="Search features..."
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-[300px] overflow-y-auto overflow-x-hidden">
                        <CommandEmpty>No feature found.</CommandEmpty>

                        <CommandGroup>
                            <CommandItem
                                value="clear-all-features-selection"
                                onSelect={() => onChange([])}
                                disabled={selectedFeatures.length === 0}
                                className={cn(
                                    "cursor-pointer justify-center text-center font-medium border-b mb-1",
                                    selectedFeatures.length === 0 ? "opacity-50" : "hover:bg-destructive/10 text-destructive"
                                )}
                            >
                                Clear Selection
                            </CommandItem>
                        </CommandGroup>

                        {FEATURE_CATEGORIES.map((category) => {
                            const filteredItems = allowedFeatures
                                ? category.items.filter(item => allowedFeatures.includes(item.key))
                                : category.items;

                            if (filteredItems.length === 0) return null;

                            const isOpen = isSearching || openCategories[category.label];
                            // Check if any item in this category is selected to highlight the header? 
                            // Optional enhancement, skipping for now to keep it clean.

                            return (
                                <div key={category.label} className="border-b last:border-0">
                                    <div
                                        className={cn(
                                            "flex items-center justify-between px-2 py-2 text-sm font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 transition-colors",
                                            isSearching && "cursor-default hover:bg-transparent"
                                        )}
                                        onClick={() => !isSearching && toggleCategory(category.label)}
                                    >
                                        <span>{category.label}</span>
                                        {!isSearching && (
                                            <ChevronsUpDown className={cn("h-3 w-3 transition-transform", isOpen ? "rotate-180" : "")} />
                                        )}
                                    </div>

                                    {(isOpen) && (
                                        <CommandGroup>
                                            {filteredItems.map((feature) => (
                                                <CommandItem
                                                    key={feature.key}
                                                    value={feature.label}
                                                    onSelect={() => handleFeatureToggle(feature.key)}
                                                    disabled={false}
                                                    className="cursor-pointer pl-4 data-[disabled]:opacity-100 data-[disabled]:pointer-events-auto"
                                                >
                                                    <div
                                                        className={cn(
                                                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                            selectedFeatures.includes(feature.key)
                                                                ? "bg-primary text-primary-foreground"
                                                                : "opacity-50 [&_svg]:invisible"
                                                        )}
                                                    >
                                                        <Check className={cn("h-4 w-4")} />
                                                    </div>
                                                    <span>{feature.label}</span>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    )}
                                </div>
                            );
                        })}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
