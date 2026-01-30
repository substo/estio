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
import { PROPERTY_LOCATIONS } from '@/lib/properties/locations';

interface LocationFilterProps {
    selectedDistricts: string[];
    selectedAreas: string[];
    onChange: (districts: string[], areas: string[]) => void;
    modal?: boolean;
    triggerClassName?: string;
}

export function LocationFilter({
    selectedDistricts,
    selectedAreas,
    onChange,
    modal = false,
    triggerClassName,
}: LocationFilterProps) {
    const [open, setOpen] = React.useState(false);

    const isDistrictSelected = (districtKey: string) => {
        return selectedDistricts.includes(districtKey);
    };

    const isAreaSelected = (areaKey: string) => {
        return selectedAreas.includes(areaKey);
    };

    const toggleDistrict = (districtKey: string) => {
        const district = PROPERTY_LOCATIONS.find((d) => d.district_key === districtKey);
        if (!district) return;

        const isSelected = isDistrictSelected(districtKey);
        let newDistricts = [...selectedDistricts];
        let newAreas = [...selectedAreas];

        if (isSelected) {
            // Deselect district
            newDistricts = newDistricts.filter((d) => d !== districtKey);
            // We keep the areas selected? Or clear them?
            // Logic: If I uncheck "Paphos", I probably want to remove all Paphos filters.
            // But if I have specific areas selected, maybe I want to keep them?
            // Let's follow the PropertyType logic:
            // If I uncheck Category, I remove it from 'categories'.
            // But if I have specific subtypes selected, they remain selected?
            // Wait, if I uncheck Category, it means "I don't want ALL Paphos".
            // If I have "Paphos Town" checked, it should remain checked.
            // BUT, if I had "Paphos" checked (meaning ALL), and I uncheck it,
            // then I have NOTHING checked for Paphos.
        } else {
            // Select district
            newDistricts.push(districtKey);
            // Remove individual areas of this district from 'areas' as they are covered by the district
            const areaKeys = district.locations.map(l => l.key);
            newAreas = newAreas.filter(a => !areaKeys.includes(a));
        }

        onChange(newDistricts, newAreas);
    };

    const toggleArea = (districtKey: string, areaKey: string) => {
        const isSelected = isAreaSelected(areaKey);
        const isDistSelected = isDistrictSelected(districtKey);

        let newDistricts = [...selectedDistricts];
        let newAreas = [...selectedAreas];

        if (isDistSelected) {
            // If District is currently selected (ALL), and we toggle an area:
            // It implies we are breaking the "All District" selection.
            // So we remove District from 'districts'.
            newDistricts = newDistricts.filter(d => d !== districtKey);

            // And we add ALL OTHER areas of this district to 'areas', except the one being toggled (if we are unchecking).
            // If we are unchecking an area from a full district selection:
            // Add all siblings to 'areas'.

            const district = PROPERTY_LOCATIONS.find(d => d.district_key === districtKey);
            if (district) {
                const siblings = district.locations.map(l => l.key);
                // Add all siblings
                siblings.forEach(s => {
                    if (s !== areaKey && !newAreas.includes(s)) {
                        newAreas.push(s);
                    }
                });
            }
        } else {
            // District not selected
            if (isSelected) {
                // Deselect area
                newAreas = newAreas.filter(a => a !== areaKey);
            } else {
                // Select area
                newAreas.push(areaKey);
            }
        }

        onChange(newDistricts, newAreas);
    };

    const totalSelected = selectedDistricts.length + selectedAreas.length;

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
                        {totalSelected === 0 && "Location"}
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
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search locations..." />
                    <CommandList className="max-h-[400px] overflow-y-auto">
                        <CommandEmpty>No location found.</CommandEmpty>
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
                        {PROPERTY_LOCATIONS.map((district) => {
                            const isDistSelected = isDistrictSelected(district.district_key);
                            return (
                                <React.Fragment key={district.district_key}>
                                    <CommandGroup>
                                        <div
                                            className="flex items-center px-2 py-1.5 cursor-pointer hover:bg-accent rounded-sm group"
                                            onClick={() => toggleDistrict(district.district_key)}
                                        >
                                            <div className={cn(
                                                "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                isDistSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                            )}>
                                                <Check className={cn("h-4 w-4")} />
                                            </div>
                                            <span className="font-semibold flex-1">{district.district_label}</span>
                                        </div>
                                        {district.locations.map((area) => {
                                            const isSubSelected = isAreaSelected(area.key);
                                            // If district is selected, area is implicitly selected visually
                                            const isEffectiveSelected = isDistSelected || isSubSelected;

                                            return (
                                                <CommandItem
                                                    key={area.key}
                                                    value={area.label}
                                                    onSelect={() => toggleArea(district.district_key, area.key)}
                                                    disabled={false}
                                                    className="pl-8 data-[disabled]:opacity-100 data-[disabled]:pointer-events-auto cursor-pointer"
                                                >
                                                    <div className={cn(
                                                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                        isEffectiveSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                                                    )}>
                                                        <Check className={cn("h-4 w-4")} />
                                                    </div>
                                                    {area.label}
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
