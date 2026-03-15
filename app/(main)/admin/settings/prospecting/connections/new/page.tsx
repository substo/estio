import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { ConnectionForm } from '../../_components/connection-form';

export default async function NewScrapingConnectionPage() {
    const { userId } = await auth();
    
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Create Platform Connection</h1>
            <ConnectionForm locationId={locationId} />
        </div>
    );
}
