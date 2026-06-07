import { TaskForm } from '../../_components/task-form';
import { ProspectingUnauthorized } from '../../_components/prospecting-unauthorized';
import { getScrapingConnections } from '../../actions';
import { notFound } from 'next/navigation';
import {
    getProspectingLocationId,
    getProspectingTask,
    serializeProspectingRecord,
} from '../../location';

export default async function EditScrapingTaskPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const locationId = await getProspectingLocationId();
    if (!locationId) return <ProspectingUnauthorized />;

    const [task, connections] = await Promise.all([
        getProspectingTask(id, locationId),
        getScrapingConnections(locationId)
    ]);

    if (!task) return notFound();
    const serializedTask = serializeProspectingRecord(task);

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Edit Scheduled Task</h1>
            <TaskForm locationId={locationId} connections={connections} initialData={serializedTask} />
        </div>
    );
}
