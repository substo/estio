import { getScrapingTargets } from './actions';
import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default async function ProspectingSettingsPage() {
    const { userId } = await auth();
    
    // Quick location resolution
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    const targets = await getScrapingTargets(locationId);

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold">Prospecting Targets</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Manage external platforms to scrape listings and populate your Lead Inbox.
                    </p>
                </div>
                <Button>Add Target</Button>
            </div>

            <div className="grid gap-4 mt-8">
                {targets.length === 0 ? (
                    <div className="text-center p-12 border rounded-lg bg-card text-muted-foreground">
                        No targets configured yet. Click "Add Target" to begin.
                    </div>
                ) : (
                    targets.map((target: any) => (
                        <div key={target.id} className="p-4 border rounded-lg bg-card flex justify-between items-center">
                            <div>
                                <h3 className="font-medium text-lg flex items-center gap-2">
                                    {target.name}
                                    {!target.enabled && (
                                        <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded text-muted-foreground">Disabled</span>
                                    )}
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Domain: {target.domain}
                                </p>
                                <div className="text-xs flex gap-4 mt-3 text-muted-foreground">
                                    <span>Sync: {target.scrapeFrequency}</span>
                                    <span>Mode: {target.extractionMode}</span>
                                    {target.lastSyncAt ? (
                                        <span className={target.lastSyncStatus === 'success' ? 'text-green-600' : 'text-red-600'}>
                                            Last Sync: {target.lastSyncAt.toLocaleString()} ({target.lastSyncStatus})
                                        </span>
                                    ) : (
                                        <span>Never synced</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm">Edit</Button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
