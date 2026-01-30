'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PROPERTY_TYPES } from '@/lib/properties/constants';

interface PropertyTypeFilterProps {
    selectedCategories: string[];
    selectedSubtypes: string[];
    onChange: (categories: string[], subtypes: string[]) => void;
    align?: "center" | "start" | "end";
    contentClassName?: string;
    triggerClassName?: string;
    modal?: boolean;
}

export function PropertyTypeFilter({
    selectedCategories,
    selectedSubtypes,
    onChange,
    align = "start",
    contentClassName,
    triggerClassName,
    modal = false,
}: PropertyTypeFilterProps) {
    const [open, setOpen] = React.useState(false);

    // Helper to check if a category is fully selected (all subtypes selected)
    // or explicitly selected as a category filter
    const isCategorySelected = (categoryKey: string) => {
        return selectedCategories.includes(categoryKey);
    };

    const isSubtypeSelected = (subtypeKey: string) => {
        return selectedSubtypes.includes(subtypeKey);
    };

    const toggleCategory = (categoryKey: string) => {
        const category = PROPERTY_TYPES.find((c) => c.category_key === categoryKey);
        if (!category) return;

        const isSelected = isCategorySelected(categoryKey);
        let newCategories = [...selectedCategories];
        let newSubtypes = [...selectedSubtypes];

        if (isSelected) {
            // Deselect category
            newCategories = newCategories.filter((c) => c !== categoryKey);
            // Also deselect all its subtypes to be clean? 
            // Or keep them? The requirement says "select all subtypes where user can unselect it individually".
            // If I select Category, it implies I want ALL properties in that category.
            // If I unselect Category, I probably want to remove that broad filter.
            // But if I have specific subtypes selected, should they remain?
            // Let's assume deselecting category removes it from 'categories' list.
            // But we also need to handle the "select all subtypes" behavior.

            // If user clicks Category, we add it to 'categories' list.
            // We DON'T necessarily add all subtypes to 'types' list, because 'categories' list covers it.
            // However, the UI needs to show them as selected.

            // Wait, if I select "House" category, and then uncheck "Bungalow", 
            // then "House" category is no longer fully selected.
            // So "House" should be removed from 'categories', and the remaining subtypes added to 'types'.

            // Strategy:
            // 1. When Category is clicked:
            //    - If not selected: Add to 'categories'. Remove any of its subtypes from 'types' (redundant).
            //    - If selected: Remove from 'categories'.
        } else {
            // Select category
            newCategories.push(categoryKey);
            // Remove individual subtypes of this category from 'types' as they are covered by the category
            const subtypeKeys = category.subtypes.map(s => s.subtype_key);
            newSubtypes = newSubtypes.filter(s => !subtypeKeys.includes(s));
        }

        onChange(newCategories, newSubtypes);
    };

    const toggleSubtype = (categoryKey: string, subtypeKey: string) => {
        const isSelected = isSubtypeSelected(subtypeKey);
        const isCatSelected = isCategorySelected(categoryKey);

        let newCategories = [...selectedCategories];
        let newSubtypes = [...selectedSubtypes];

        if (isCatSelected) {
            // If Category is currently selected, and we toggle a subtype:
            // It implies we are breaking the "All Category" selection.
            // So we remove Category from 'categories'.
            newCategories = newCategories.filter(c => c !== categoryKey);

            // And we add ALL OTHER subtypes of this category to 'types', except the one being toggled (if we are unchecking).
            // If we are unchecking a subtype from a full category selection:
            // Add all siblings to 'types'.

            const category = PROPERTY_TYPES.find(c => c.category_key === categoryKey);
            if (category) {
                const siblings = category.subtypes.map(s => s.subtype_key);
                // Add all siblings
                siblings.forEach(s => {
                    if (s !== subtypeKey && !newSubtypes.includes(s)) {
                        newSubtypes.push(s);
                    }
                });
            }
        } else {
            // Category not selected
            if (isSelected) {
                // Deselect subtype
                newSubtypes = newSubtypes.filter(s => s !== subtypeKey);
            } else {
                // Select subtype
                newSubtypes.push(subtypeKey);

                // Check if we now have ALL subtypes selected for this category?
                // If so, maybe upgrade to Category selection?
                // Optional optimization. Let's keep it simple for now.
            }
        }

        onChange(newCategories, newSubtypes);
    };

    const totalSelected = selectedCategories.length + selectedSubtypes.length;

    return (
        <Popover open={open} onOpenChange={setOpen} modal={modal}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("w-full justify-between", triggerClassName)}
                >
                    <div className="flex gap-1 flex-wrap truncate">
                        {totalSelected === 0 && "Type"}
                        {totalSelected > 0 && (
                            <Badge variant="secondary" className="mr-1">
                                {totalSelected} selected
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center">
                        {totalSelected > 0 && (
                            <div
                                role="button"
                                tabIndex={0}
                                className="mr-2 hover:bg-muted rounded-full p-1 cursor-pointer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onChange([], []);
                                }}
                            >
                                <X className="h-4 w-4 opacity-50 hover:opacity-100" />
                            </div>
                        )}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent className={cn("w-[300px] p-0", contentClassName)} align={align}>
                <Command>
                    <CommandInput placeholder="Search types..." />
                    <CommandList>
                        <CommandEmpty>No type found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="clear-filters"
                                disabled={false}
                                onSelect={() => onChange([], [])}
                                className="justify-center text-center font-medium data-[disabled]:opacity-100 data-[disabled]:pointer-events-auto cursor-pointer"
                            >
                                Clear Filters
                            </CommandItem>
                        </CommandGroup>
                        <Separator />
                        {PROPERTY_TYPES.map((category) => {
                            const isCatSelected = isCategorySelected(category.category_key);
                            return (
                                <React.Fragment key={category.category_key}>
                                    <CommandGroup>
                                        <div
                                            className="flex items-center px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm group"
                                            onClick={() => toggleCategory(category.category_key)}
                                        >
                                            <div className={cn(
                                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                isCatSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                            )}>
                                                <Check className={cn("h-4 w-4")} />
                                            </div>
                                            <span className="font-semibold flex-1">{category.category_label}</span>
                                        </div>
                                        {category.subtypes.map((subtype) => {
                                            const isSubSelected = isSubtypeSelected(subtype.subtype_key);
                                            // If category is selected, subtype is implicitly selected visually
                                            const isEffectiveSelected = isCatSelected || isSubSelected;

                                            return (
                                                <CommandItem
                                                    key={subtype.subtype_key}
                                                    value={subtype.subtype_label}
                                                    onSelect={() => toggleSubtype(category.category_key, subtype.subtype_key)}
                                                    disabled={false}
                                                    className="pl-8 data-[disabled]:opacity-100 data-[disabled]:pointer-events-auto cursor-pointer"
                                                >
                                                    <div className={cn(
                                                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                        isEffectiveSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                                    )}>
                                                        <Check className={cn("h-4 w-4")} />
                                                    </div>
                                                    {subtype.subtype_label}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                    <Separator />
                                </React.Fragment>
                            );
                        })}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
