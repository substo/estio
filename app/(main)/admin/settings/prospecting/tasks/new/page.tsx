import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { TaskForm } from '../../_components/task-form';
import { getScrapingConnections } from '../../actions';

export default async function NewScrapingTaskPage() {
    const { userId } = await auth();
    
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    const connections = await getScrapingConnections(locationId);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Create Scheduled Task</h1>
            {connections.length === 0 ? (
                <div className="p-4 border border-destructive bg-destructive/10 text-destructive rounded-md max-w-2xl">
                    You must create a Platform Connection before scheduling a task.
                </div>
            ) : (
                <TaskForm locationId={locationId} connections={connections} />
            )}
        </div>
    );
}
