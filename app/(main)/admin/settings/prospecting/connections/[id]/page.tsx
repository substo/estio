import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { ConnectionForm } from '../../_components/connection-form';
import { notFound } from 'next/navigation';

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

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Edit Platform Connection</h1>
            <ConnectionForm locationId={locationId} initialData={connection} />
        </div>
    );
}
