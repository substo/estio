import { CredentialForm } from '../../../../_components/credential-form';
import { ProspectingUnauthorized } from '../../../../_components/prospecting-unauthorized';
import { notFound } from 'next/navigation';
import {
    getProspectingConnection,
    getProspectingCredential,
    getProspectingLocationId,
} from '../../../../location';

export default async function EditScrapingCredentialPage({ params }: { params: Promise<{ id: string, credId: string }> }) {
    const { id: connectionId, credId } = await params;
    const locationId = await getProspectingLocationId();
    if (!locationId) return <ProspectingUnauthorized />;

    const connection = await getProspectingConnection(connectionId, locationId);
    if (!connection) return notFound();

    const credential = await getProspectingCredential(credId, connectionId);
    if (!credential) return notFound();

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-6">Edit Credential</h1>
            <CredentialForm connectionId={connectionId} locationId={locationId} initialData={credential} platform={connection.platform} />
        </div>
    );
}
