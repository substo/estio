import { ConnectionForm } from '../../_components/connection-form';
import { ProspectingUnauthorized } from '../../_components/prospecting-unauthorized';
import { getProspectingLocationId } from '../../location';

export default async function NewScrapingConnectionPage() {
    const locationId = await getProspectingLocationId();
    if (!locationId) return <ProspectingUnauthorized />;

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Create Platform Connection</h1>
            <ConnectionForm locationId={locationId} />
        </div>
    );
}
