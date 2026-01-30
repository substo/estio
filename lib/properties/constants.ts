export const PROPERTY_TYPES = [
    {
        "category_key": "house",
        "category_label": "House",
        "subtypes": [
            { "subtype_key": "detached_villa", "subtype_label": "Detached Villa" },
            { "subtype_key": "semi_detached_villa", "subtype_label": "Semi Detached Villa" },
            { "subtype_key": "town_house", "subtype_label": "Town House" },
            { "subtype_key": "traditional_house", "subtype_label": "Traditional House" },
            { "subtype_key": "bungalow", "subtype_label": "Bungalow" }
        ]
    },
    {
        "category_key": "apartment",
        "category_label": "Apartment",
        "subtypes": [
            { "subtype_key": "studio", "subtype_label": "Studio" },
            { "subtype_key": "apartment", "subtype_label": "Apartment" },
            { "subtype_key": "penthouse", "subtype_label": "Penthouse" },
            { "subtype_key": "ground_floor_apartment", "subtype_label": "Ground Floor Apartment" }
        ]
    },
    {
        "category_key": "commercial",
        "category_label": "Commercial",
        "subtypes": [
            { "subtype_key": "shop", "subtype_label": "Shop" },
            { "subtype_key": "office", "subtype_label": "Office" },
            { "subtype_key": "business", "subtype_label": "Business" },
            { "subtype_key": "building", "subtype_label": "Building" },
            { "subtype_key": "project", "subtype_label": "Project" },
            { "subtype_key": "showroom", "subtype_label": "Showroom" },
            { "subtype_key": "hotel", "subtype_label": "Hotel" },
            { "subtype_key": "warehouse", "subtype_label": "Warehouse" },
            { "subtype_key": "other_commercial", "subtype_label": "Other" }
        ]
    },
    {
        "category_key": "land",
        "category_label": "Land",
        "subtypes": [
            { "subtype_key": "residential_land", "subtype_label": "Residential Land" },
            { "subtype_key": "agricultural_land", "subtype_label": "Agricultural Land" },
            { "subtype_key": "industrial_land", "subtype_label": "Industrial Land" },
            { "subtype_key": "touristic_land", "subtype_label": "Touristic Land" },
            { "subtype_key": "commercial_land", "subtype_label": "Commercial Land" },
            { "subtype_key": "land_with_permits", "subtype_label": "Land with permits" }
        ]
    }
];

export const RENTAL_PERIODS = ['/month', '/week', '/day', '/year'];

export function getCategoryLabel(key: string): string {
    const category = PROPERTY_TYPES.find(c => c.category_key === key);
    return category ? category.category_label : key;
}

export function getSubtypeLabel(key: string): string {
    for (const category of PROPERTY_TYPES) {
        const subtype = category.subtypes.find(s => s.subtype_key === key);
        if (subtype) return subtype.subtype_label;
    }
    return key;
}

export function getCategoryForSubtype(subtypeKey: string): string | null {
    for (const category of PROPERTY_TYPES) {
        if (category.subtypes.some(s => s.subtype_key === subtypeKey)) {
            return category.category_key;
        }
    }
    return null;
}
