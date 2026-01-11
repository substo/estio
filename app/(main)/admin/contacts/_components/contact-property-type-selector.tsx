'use client';

import { useState, useEffect } from 'react';
import { PropertyTypeFilter } from '@/components/properties/property-type-filter';
import { PROPERTY_TYPES } from '@/lib/properties/constants';

interface ContactPropertyTypeSelectorProps {
    defaultValue?: string[];
    name?: string;
}

export function ContactPropertyTypeSelector({ defaultValue = [], name = "requirementPropertyTypes" }: ContactPropertyTypeSelectorProps) {
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
    const [selectedSubtypes, setSelectedSubtypes] = useState<string[]>([]);

    // Initialize state from defaultValue
    // Using JSON.stringify to stabilize the dependency - arrays create new references each render
    const defaultValueKey = JSON.stringify(defaultValue);
    useEffect(() => {
        const cats: string[] = [];
        const subs: string[] = [];

        defaultValue.forEach(val => {
            if (val.startsWith('cat:')) {
                cats.push(val.replace('cat:', ''));
            } else if (val.startsWith('sub:')) {
                subs.push(val.replace('sub:', ''));
            } else {
                // Try to infer from raw value (legacy support)
                // Check if it matches a category key
                const isCat = PROPERTY_TYPES.some(c => c.category_key === val);
                if (isCat) {
                    cats.push(val);
                } else {
                    // Check if it matches a subtype key
                    for (const cat of PROPERTY_TYPES) {
                        if (cat.subtypes.some(s => s.subtype_key === val)) {
                            subs.push(val);
                            break;
                        }
                    }
                }
            }
        });

        setSelectedCategories(cats);
        setSelectedSubtypes(subs);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultValueKey]); // Use serialized key to prevent infinite loops

    const handleChange = (newCategories: string[], newSubtypes: string[]) => {
        setSelectedCategories(newCategories);
        setSelectedSubtypes(newSubtypes);
    };

    // Serialize selections for the hidden input
    // Format: ["cat:house", "sub:villa"]
    const serializedValue = JSON.stringify([
        ...selectedCategories.map(c => `cat:${c}`),
        ...selectedSubtypes.map(s => `sub:${s}`)
    ]);

    return (
        <div className="space-y-2">
            <input type="hidden" name={name} value={serializedValue} />
            <PropertyTypeFilter
                selectedCategories={selectedCategories}
                selectedSubtypes={selectedSubtypes}
                onChange={handleChange}
                contentClassName="w-[--radix-popover-trigger-width]"
            />
            {/* Display selected chips or text below for clarity if needed, 
                but the filter component itself handles the badge count.
                Maybe show a small text summary? 
            */}
            {(selectedCategories.length > 0 || selectedSubtypes.length > 0) && (
                <p className="text-xs text-muted-foreground mt-1">
                    Selected: {selectedCategories.length} categories, {selectedSubtypes.length} specific types
                </p>
            )}
        </div>
    );
}
