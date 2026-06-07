import { CredentialForm } from '../../../../_components/credential-form';
import { ProspectingUnauthorized } from '../../../../_components/prospecting-unauthorized';
import { notFound } from 'next/navigation';
import { getProspectingConnection, getProspectingLocationId } from '../../../../location';

export default async function NewScrapingCredentialPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: connectionId } = await params;
    const locationId = await getProspectingLocationId();
    if (!locationId) return <ProspectingUnauthorized />;

    const connection = await getProspectingConnection(connectionId, locationId);
    if (!connection) return notFound();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-2">Add Credential to {connection.name}</h1>
            <p className="text-muted-foreground text-sm mb-6">This account will be dynamically rotated into the pool for task assignment.</p>
            <CredentialForm connectionId={connectionId} locationId={locationId} platform={connection.platform} />
        </div>
    );
}
