'use client';

import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { type ScrapedListingRow } from '@/lib/leads/scraped-listing-repository';
import { ProspectList } from './prospect-list';
import { ProspectListingsView } from './prospect-listings-view';

interface ProspectingSplitViewProps {
    prospects: ProspectInboxRow[];
    prospectsTotal: number;
    listings: ScrapedListingRow[];
    listingsTotal: number;
    selectedProspectId?: string;
    locationId: string;
}

export function ProspectingSplitView({
    prospects,
    prospectsTotal,
    listings,
    listingsTotal,
    selectedProspectId,
    locationId
}: ProspectingSplitViewProps) {
    const selectedProspect = prospects.find(p => p.id === selectedProspectId);

    return (
        <div className="flex flex-1 overflow-hidden h-full gap-6">
            {/* Left Pane: Leads List */}
            <div className="w-1/3 flex flex-col h-full border rounded-xl bg-card overflow-hidden">
                <ProspectList 
                    items={prospects} 
                    total={prospectsTotal} 
                    selectedId={selectedProspectId} 
                />
            </div>

            {/* Right Pane: Listings */}
            <div className="w-2/3 flex flex-col h-full border rounded-xl bg-card overflow-hidden">
                <ProspectListingsView 
                    prospect={selectedProspect} 
                    listings={listings} 
                    total={listingsTotal}
                    locationId={locationId} 
                />
            </div>
        </div>
    );
}
