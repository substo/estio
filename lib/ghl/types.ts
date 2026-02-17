export interface GHLTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    userType: string;
}

export interface GHLUser {
    id: string;
    name?: string;       // Full name (legacy/fallback)
    firstName?: string;  // GHL API field
    lastName?: string;   // GHL API field
    email: string;
    phone?: string;      // GHL API field
    roles: {
        type: string;
        role: string;
        locationIds: string[];
    };
    type?: string;
    role?: string;
    locationIds?: string[];
}

export type PropertyStatus = 'Active' | 'Reserved' | 'Sold' | 'Rented' | 'Withdrawn';
export type PropertyGoal = 'For Sale' | 'For Rent';
export type PublicationStatus = 'Published' | 'Draft' | 'Unlisted' | 'Pending';
export type PropertyLocation = 'Paphos' | 'Limassol' | 'Larnaca' | 'Nicosia' | 'Famagusta';
export type PropertyTypeCategory = 'house' | 'apartment' | 'commercial' | 'land';
export type PropertyTypeSubtype =
    | 'detached_villa' | 'semi_detached_villa' | 'town_house' | 'traditional_house' | 'bungalow'
    | 'studio' | 'apartment' | 'penthouse' | 'ground_floor_apartment'
    | 'shop' | 'office' | 'business' | 'building' | 'project' | 'showroom' | 'hotel' | 'warehouse' | 'other_commercial'
    | 'residential_land' | 'agricultural_land' | 'industrial_land' | 'touristic_land' | 'commercial_land' | 'land_with_permits';
export type PropertyCurrency = 'EUR' | 'GBP' | 'USD';
export type PropertyCondition = 'New' | 'Resale' | 'Off-plan' | 'Under Construction';

export interface GHLProperty {
    id: string;
    locationId: string;
    properties: {
        property_reference: string;
        reference_number?: string; // Human readable reference (e.g. DT1234)
        title: string;
        status: PropertyStatus;
        goal: PropertyGoal;
        publication_status: PublicationStatus;
        location: PropertyLocation;
        location_area?: string;
        area: string;
        address_line: string;
        type_category: PropertyTypeCategory;
        type_subtype?: PropertyTypeSubtype;
        bedrooms?: number;
        bathrooms?: number;
        internal_size_sqm?: number;
        plot_size_sqm?: number;
        price?: number;
        currency: PropertyCurrency;
        condition?: PropertyCondition;
        headline_features?: string;
        internal_notes?: string;
        is_featured?: boolean;
        show_on_website?: boolean;
        features?: string[];
        build_year?: number;
        floor?: number;
        owner_name?: string;
        source?: string;
    };
    dateAdded: string;
    dateUpdated: string;
}


export interface GHLContact {
    id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    tags?: string[];
    customFields?: Record<string, any>;
    dateAdded?: string;
    dateUpdated?: string;
}

export interface GHLCompany {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    website?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
}

export interface GHLListResponse<T> {
    customObjects?: T[]; // For Custom Objects
    contacts?: T[];      // For Contacts
    companies?: T[];     // For Companies (if applicable)
    total: number;
    meta?: {
        startAfterId?: string;
        startAfter?: number;
        nextPageUrl?: string;
    };
}

export interface GHLLocation {
    id: string;
    name: string;
    companyId?: string; // The parent company/agency ID
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    website?: string;
    timezone?: string;
    defaultEmailService?: string;
    mailgun?: {
        apiKey: string;
        domain: string;
    };
    // Placeholder for other potential provider fields
    smtp?: any;
}
