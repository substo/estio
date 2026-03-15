import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { ConnectionForm } from '../../_components/connection-form';
import { getScrapingCredentials } from '../../actions';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, Pencil, Trash } from 'lucide-react';

export default async function EditScrapingConnectionPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { userId } = await auth();
    
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    const connection = await db.scrapingConnection.findUnique({
        where: { id, locationId }
    });

    if (!connection) return notFound();

    const credentials = await getScrapingCredentials(connection.id);

    return (
        <div className="p-6 space-y-8 max-w-4xl max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold mb-6">Edit Platform Connection</h1>
                <ConnectionForm locationId={locationId} initialData={connection} />
            </div>

            <div className="border-t pt-8">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-bold">Credential Pool</h2>
                        <p className="text-sm text-muted-foreground">Accounts that tasks will rotate through for this platform.</p>
                    </div>
                    <Link href={`/admin/settings/prospecting/connections/${connection.id}/credentials/new`}>
                        <Button className="gap-2">
                            <Plus className="w-4 h-4" /> Add Credential
                        </Button>
                    </Link>
                </div>

                <div className="bg-card border rounded-lg shadow-sm">
                    {credentials.length === 0 ? (
                        <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
                            <p>No credentials added yet.</p>
                            <p className="text-sm mt-1">Tasks using this connection will fail until a healthy login is provided.</p>
                        </div>
                    ) : (
                        <ul className="divide-y relative">
                            {credentials.map((cred: any) => (
                                <li key={cred.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
                                    <div className="grid gap-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm">{cred.authUsername}</span>
                                            {cred.status === 'active' && <span className="text-[10px] font-medium bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full uppercase">Active</span>}
                                            {cred.status === 'rate_limited' && <span className="text-[10px] font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full uppercase">Rate Limited</span>}
                                            {cred.status === 'banned' && <span className="text-[10px] font-medium bg-red-100 text-red-800 px-2 py-0.5 rounded-full uppercase">Banned</span>}
                                        </div>
                                        <div className="text-xs text-muted-foreground flex gap-4">
                                            <span>Health: {cred.healthScore}/100</span>
                                            {cred.lastUsedAt ? <span>Last Used: {new Date(cred.lastUsedAt).toLocaleString()}</span> : <span>Never Used</span>}
                                            {cred.sessionState ? <span className="text-emerald-600">Session Cached</span> : <span className="text-amber-600">No Session</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Link href={`/admin/settings/prospecting/connections/${connection.id}/credentials/${cred.id}`}>
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                <Pencil className="w-4 h-4" />
                                            </Button>
                                        </Link>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
