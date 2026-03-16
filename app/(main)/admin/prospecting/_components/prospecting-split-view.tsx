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

            {/* Right Pane: Listings for Selected Lead */}
            <div className="w-2/3 flex flex-col h-full border rounded-xl bg-card overflow-hidden">
                {selectedProspectId ? (
                    <ProspectListingsView 
                        prospect={selectedProspect} 
                        listings={listings} 
                        total={listingsTotal}
                        locationId={locationId} 
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                        <div className="text-4xl mb-4">👈</div>
                        <h3 className="text-lg font-medium text-foreground">Select a Prospect</h3>
                        <p className="max-w-sm mt-2">
                            Choose a prospect from the list to view their contact details and all their associated property listings.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
