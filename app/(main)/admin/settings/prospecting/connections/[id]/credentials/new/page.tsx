import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { CredentialForm } from '../../../../_components/credential-form';
import { notFound } from 'next/navigation';

export default async function NewScrapingCredentialPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: connectionId } = await params;
    const { userId } = await auth();
    
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    // Verify parent
    const connection = await db.scrapingConnection.findUnique({
        where: { id: connectionId, locationId }
    });

    if (!connection) return notFound();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-2">Add Credential to {connection.name}</h1>
            <p className="text-muted-foreground text-sm mb-6">This account will be dynamically rotated into the pool for task assignment.</p>
            <CredentialForm connectionId={connectionId} locationId={locationId} />
        </div>
    );
}
