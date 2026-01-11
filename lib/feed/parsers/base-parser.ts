
export interface FeedItem {
    externalId: string;
    title: string;
    description?: string;
    price?: number;
    currency?: string;
    url?: string;
    images: string[];
    attributes: Record<string, any>; // Flexible for other attributes (bedrooms, area, etc.)
    location?: {
        address?: string;
        city?: string;
        country?: string;
        latitude?: number;
        longitude?: number;
    };
    bedrooms?: number;
    bathrooms?: number;
    areaSqm?: number;
}

export interface FeedParser {
    parse(content: string): Promise<FeedItem[]>;
}
