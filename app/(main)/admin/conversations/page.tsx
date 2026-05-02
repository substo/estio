import { Suspense } from 'react';
import { getLocationContext } from '@/lib/auth/location-context';
import { fetchConversations } from './actions';
import { getDealContexts } from '../deals/actions';
import { ConversationInterface } from './_components/conversation-interface';
import { getConversationFeatureFlags } from '@/lib/feature-flags';

// Force dynamic because we fetch real-time data
export const dynamic = 'force-dynamic';

export default async function ConversationsPage({ searchParams }: { searchParams?: any }) {
    const location = await getLocationContext();

    if (!location) {
        return <div className="p-8">Unauthorized. Please login.</div>;
    }

    const resolvedSearchParams =
        searchParams && typeof searchParams.then === 'function'
            ? await searchParams
            : (searchParams || {});
    const selectedConversationId = Array.isArray(resolvedSearchParams?.id)
        ? resolvedSearchParams.id[0]
        : resolvedSearchParams?.id;
    const initialViewFilterParam = Array.isArray(resolvedSearchParams?.view)
        ? resolvedSearchParams.view[0]
        : resolvedSearchParams?.view;
    const initialViewModeParam = Array.isArray(resolvedSearchParams?.mode)
        ? resolvedSearchParams.mode[0]
        : resolvedSearchParams?.mode;
    const initialConversationStatus = (initialViewFilterParam === 'archived' || initialViewFilterParam === 'trash' || initialViewFilterParam === 'tasks')
        ? initialViewFilterParam
        : 'active';
    const initialViewMode = initialViewModeParam === 'deals' ? 'deals' : 'chats';

    // Keep first paint focused on the active conversations path.
    // Deal data is only preloaded when the user lands directly in deal mode.
    const [initialConversationsData, initialDealsData] = await Promise.all([
        fetchConversations(
            initialConversationStatus === 'tasks' ? 'active' : initialConversationStatus,
            selectedConversationId
        ),
        initialViewMode === 'deals' ? getDealContexts() : Promise.resolve([])
    ]);
    const featureFlags = getConversationFeatureFlags(location.id);

    return (
        <div className="h-[calc(100dvh-56px)] lg:h-[calc(100dvh-55px)] w-full max-w-full min-w-0 overflow-hidden flex flex-col">


            <main className="flex-1 overflow-hidden relative">
                <Suspense fallback={<div>Loading Interface...</div>}>
                    <ConversationInterface
                        locationId={location.id}
                        initialConversations={initialConversationsData.conversations}
                        initialConversationListPageInfo={{
                            hasMore: !!initialConversationsData.hasMore,
                            nextCursor: initialConversationsData.nextCursor || null,
                            deltaCursor: initialConversationsData.deltaCursor || null,
                        }}
                        initialDeals={initialDealsData}
                        featureFlags={featureFlags}
                    />
                </Suspense>
            </main>
        </div>
    );
}
