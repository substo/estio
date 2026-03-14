import { Badge } from "@/components/ui/badge";
import { LEAD_SOURCE_CATEGORIES } from "./contact-types";

type CategoryKey = keyof typeof LEAD_SOURCE_CATEGORIES;

export function categorizeSource(source: string | null | undefined): CategoryKey {
    if (!source) return 'manual';

    const s = source.toLowerCase();

    // Portals
    if (s.includes('bazaraki')) return 'bazaraki_scrape';
    if (s.includes('right move') || s.includes('portal') || s.includes('a place in the sun')) return 'property_portal';

    // Social Media
    if (s.includes('facebook') && !s.includes('ads')) return 'facebook';
    if (s.includes('facebookads') || s.includes('ads')) return 'google_ads'; // Simplification for now
    if (s.includes('instagram')) return 'instagram';
    if (s.includes('linkedin')) return 'linkedin';

    // Website & Feeds
    if (s.includes('website') || s.includes('inquiry')) return 'website_inquiry';
    if (s.includes('xml') || s.includes('feed')) return 'xml_feed';

    // Offline / Direct
    if (s.includes('walk-in') || s.includes('sign board')) return 'walk_in';
    if (s.includes('referral') || s.includes('growth together')) return 'referral';
    if (s.includes('manual') || s.includes('none')) return 'manual';

    // Default to manual / other
    return 'manual';
}

interface LeadSourceBadgeProps {
    source: string | null | undefined;
    size?: 'xs' | 'sm' | 'default';
}

export function LeadSourceBadge({ source, size = 'default' }: LeadSourceBadgeProps) {
    if (!source) return null;

    const categoryKey = categorizeSource(source);
    const category = LEAD_SOURCE_CATEGORIES[categoryKey];

    const sizeClasses = {
        xs: 'text-[10px] px-1.5 py-0 h-4',
        sm: 'text-xs px-2 py-0.5',
        default: 'text-xs',
    };

    return (
        <Badge
            variant="outline"
            className={`${category.color} ${sizeClasses[size]} flex items-center gap-1.5 w-fit font-medium whitespace-nowrap`}
            title={source} // Tooltip showing original raw source 
        >
            <span>{category.icon}</span>
            <span>{category.label}</span>
        </Badge>
    );
}
