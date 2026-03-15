import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { TaskForm } from '../../_components/task-form';
import { getScrapingConnections } from '../../actions';
import { notFound } from 'next/navigation';

export default async function EditScrapingTaskPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { userId } = await auth();
    
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    const [task, connections] = await Promise.all([
        db.scrapingTask.findUnique({ where: { id, locationId } }),
        getScrapingConnections(locationId)
    ]);

    if (!task) return notFound();

    // Serialize to plain JSON to avoid React Server Component Date serialization errors
    const serializedTask = JSON.parse(JSON.stringify(task));

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Edit Scheduled Task</h1>
            <TaskForm locationId={locationId} connections={connections} initialData={serializedTask} />
        </div>
    );
}
