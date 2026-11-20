import { TaskForm } from '../../_components/task-form';
import { ProspectingUnauthorized } from '../../_components/prospecting-unauthorized';
import { getScrapingConnections } from '../../actions';
import { getProspectingLocationId } from '../../location';

export default async function NewScrapingTaskPage() {
    const locationId = await getProspectingLocationId();
    if (!locationId) return <ProspectingUnauthorized />;

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
