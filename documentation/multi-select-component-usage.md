# Multi-Select Component Usage Guide

This guide explains how to use the hierarchical multi-select components (`LocationFilter` and `PropertyTypeFilter`) in other parts of the application.

## 1. Component Overview

The multi-select components provide a user-friendly interface for selecting items from a hierarchical list (e.g., District -> Area, Category -> Subtype).

**Key Features:**
- **Hierarchical Selection**: Selecting a parent automatically selects all children.
- **Search**: Built-in search for finding items quickly.
- **Badges**: Displays selected count (e.g., "3 selected").
- **Indeterminate State**: Visual indication when only some children are selected.

## 2. Using `LocationFilter`

### Import
```tsx
import { LocationFilter } from "@/components/properties/location-filter";
```

### Props
| Prop | Type | Description |
| :--- | :--- | :--- |
| `selectedDistricts` | `string[]` | Array of selected district keys (e.g., `['paphos']`) |
| `selectedAreas` | `string[]` | Array of selected area keys (e.g., `['paphos_town']`) |
| `onChange` | `(districts: string[], areas: string[]) => void` | Callback fired when selection changes |

### Example Usage
```tsx
"use client";

import { useState } from "react";
import { LocationFilter } from "@/components/properties/location-filter";

export function MyPage() {
    const [districts, setDistricts] = useState<string[]>([]);
    const [areas, setAreas] = useState<string[]>([]);

    const handleLocationChange = (newDistricts: string[], newAreas: string[]) => {
        setDistricts(newDistricts);
        setAreas(newAreas);
        console.log("Selected Districts:", newDistricts);
        console.log("Selected Areas:", newAreas);
    };

    return (
        <div className="p-4">
            <h2 className="mb-4">Select Location</h2>
            <div className="w-[250px]">
                <LocationFilter
                    selectedDistricts={districts}
                    selectedAreas={areas}
                    onChange={handleLocationChange}
                />
            </div>
        </div>
    );
}
```

## 3. Using `PropertyTypeFilter`

### Import
```tsx
import { PropertyTypeFilter } from "@/components/properties/property-type-filter";
```

### Props
| Prop | Type | Description |
| :--- | :--- | :--- |
| `selectedCategories` | `string[]` | Array of selected category keys (e.g., `['residential']`) |
| `selectedTypes` | `string[]` | Array of selected subtype keys (e.g., `['apartment']`) |
| `onChange` | `(categories: string[], types: string[]) => void` | Callback fired when selection changes |

### Example Usage
```tsx
"use client";

import { useState } from "react";
import { PropertyTypeFilter } from "@/components/properties/property-type-filter";

export function MyPage() {
    const [categories, setCategories] = useState<string[]>([]);
    const [types, setTypes] = useState<string[]>([]);

    const handleTypeChange = (newCategories: string[], newTypes: string[]) => {
        setCategories(newCategories);
        setTypes(newTypes);
    };

    return (
        <div className="p-4">
            <h2 className="mb-4">Select Property Type</h2>
            <div className="w-[250px]">
                <PropertyTypeFilter
                    selectedCategories={categories}
                    selectedTypes={types}
                    onChange={handleTypeChange}
                />
            </div>
        </div>
    );
}
```

## 4. Using `BedroomsFilter`

### Import
```tsx
import { BedroomsFilter } from "@/components/properties/bedrooms-filter";
```

### Props
| Prop | Type | Description |
| :--- | :--- | :--- |
| `selectedBedrooms` | `string[]` | Array of selected bedroom counts (e.g., `['2', '3', '5+']`) |
| `onChange` | `(bedrooms: string[]) => void` | Callback fired when selection changes |

### Example Usage
```tsx
"use client";

import { useState } from "react";
import { BedroomsFilter } from "@/components/properties/bedrooms-filter";

export function MyPage() {
    const [bedrooms, setBedrooms] = useState<string[]>([]);

    const handleBedroomsChange = (newBedrooms: string[]) => {
        setBedrooms(newBedrooms);
    };

    return (
        <div className="p-4">
            <h2 className="mb-4">Select Bedrooms</h2>
            <div className="w-[200px]">
                <BedroomsFilter
                    selectedBedrooms={bedrooms}
                    onChange={handleBedroomsChange}
                />
            </div>
        </div>
    );
}
```

## 5. Data Sources

The components rely on static data constants. If you need to modify the available options, edit the following files:

- **Locations**: `lib/properties/locations.ts` (`PROPERTY_LOCATIONS`)
- **Property Types**: `lib/properties/constants.ts` (`PROPERTY_TYPES`)

## 6. URL Parameter Integration

To sync the filter with URL parameters (like in the Properties page):

1.  **Read Params**: Use `useSearchParams` to initialize the state.
2.  **Update URL**: In the `onChange` handler, update the URL search params.

```tsx
import { useRouter, useSearchParams } from "next/navigation";

// ... inside component
const router = useRouter();
const searchParams = useSearchParams();

const selectedDistricts = searchParams.get('locations')?.split(',') || [];
const selectedAreas = searchParams.get('areas')?.split(',') || [];

const handleChange = (districts: string[], areas: string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (districts.length) params.set('locations', districts.join(','));
    else params.delete('locations');

    if (areas.length) params.set('areas', areas.join(','));
    else params.delete('areas');

    router.push(`?${params.toString()}`);
};
```
