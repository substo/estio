import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { CredentialForm } from '../../../../_components/credential-form';
import { notFound } from 'next/navigation';

export default async function EditScrapingCredentialPage({ params }: { params: Promise<{ id: string, credId: string }> }) {
    const { id: connectionId, credId } = await params;
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

    const credential = await db.scrapingCredential.findUnique({
        where: { id: credId, connectionId }
    });

    if (!credential) return notFound();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Edit Credential</h1>
            <CredentialForm connectionId={connectionId} locationId={locationId} initialData={credential} platform={connection.platform} />
        </div>
    );
}
