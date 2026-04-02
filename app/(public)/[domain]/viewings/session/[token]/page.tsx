import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import { hashViewingSessionToken } from "@/lib/viewings/sessions/security";
import { ClientSessionView } from "./_components/client-session-view";

export const dynamic = "force-dynamic";

export default async function PublicViewingSessionPage(
    { params }: { params: Promise<{ domain: string; token: string }> }
) {
    const { domain, token } = await params;
    const normalizedDomain = String(domain || "").trim();
    const normalizedToken = String(token || "").trim();
    if (!normalizedDomain || !normalizedToken) notFound();

    const siteConfig = await getSiteConfig(normalizedDomain);
    if (!siteConfig?.locationId) notFound();

    const session = await db.viewingSession.findFirst({
        where: {
            sessionLinkTokenHash: hashViewingSessionToken(normalizedToken),
            locationId: siteConfig.locationId,
        },
        select: {
            id: true,
            status: true,
            mode: true,
            clientName: true,
            clientLanguage: true,
            agentLanguage: true,
            primaryProperty: {
                select: {
                    title: true,
                    reference: true,
                },
            },
            agent: {
                select: {
                    name: true,
                    firstName: true,
                    lastName: true,
                },
            },
        },
    });
    if (!session) notFound();

    return (
        <ClientSessionView
            token={normalizedToken}
            preview={{
                id: session.id,
                clientName: session.clientName || null,
                status: session.status,
                mode: session.mode,
                clientLanguage: session.clientLanguage || null,
                agentLanguage: session.agentLanguage || null,
                property: {
                    title: session.primaryProperty.title,
                    reference: session.primaryProperty.reference || null,
                },
                agent: {
                    name: session.agent.name || [session.agent.firstName, session.agent.lastName].filter(Boolean).join(" ") || "Agent",
                },
            }}
        />
    );
}
