import { Suspense } from 'react';
import { getLocationContext } from '@/lib/auth/location-context';
import { fetchConversations } from './actions';
import { getDealContexts } from '../deals/actions';
import { ConversationInterface } from './_components/conversation-interface';
import { getConversationFeatureFlags } from '@/lib/feature-flags';
import { canViewLocationContacts, getActiveContactsAccess } from '@/lib/contacts/active-location-access';
import { resolveConversationScope } from '@/lib/conversations/contact-assignment-access';
import Link from 'next/link';

// Force dynamic because we fetch real-time data
export const dynamic = 'force-dynamic';

export default async function ConversationsPage({ searchParams }: { searchParams?: any }) {
    const [location, access] = await Promise.all([
        getLocationContext(),
        getActiveContactsAccess(),
    ]);

    if (!location || !access || location.id !== access.locationId) {
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
    const initialConversationStatus = initialViewModeParam === 'tasks'
        ? 'tasks'
        : (initialViewFilterParam === 'archived' || initialViewFilterParam === 'trash' || initialViewFilterParam === 'tasks')
            ? initialViewFilterParam
            : 'active';
    const initialViewMode = initialViewModeParam === 'deals' ? 'deals' : 'chats';
    const requestedScope = Array.isArray(resolvedSearchParams?.scope)
        ? resolvedSearchParams.scope[0]
        : resolvedSearchParams?.scope;
    const conversationScope = resolveConversationScope(access, requestedScope);
    const shouldPreloadConversations = initialConversationStatus !== 'tasks';

    // Keep first paint focused on the active conversations path.
    // Deal data is only preloaded when the user lands directly in deal mode.
    const [initialConversationsData, initialDealsData] = await Promise.all([
        shouldPreloadConversations
            ? fetchConversations(initialConversationStatus, selectedConversationId, { scope: conversationScope })
            : Promise.resolve({
                conversations: [],
                hasMore: false,
                nextCursor: null,
                deltaCursor: null,
            }),
        initialViewMode === 'deals' ? getDealContexts(conversationScope) : Promise.resolve([])
    ]);
    const featureFlags = getConversationFeatureFlags(location.id, { locationSmsRelayEnabled: !!(location as any).smsRelayEnabled });

    return (
        <div className="h-full min-h-0 w-full max-w-full min-w-0 overflow-hidden flex flex-col">
            <h1 className="sr-only">Conversations</h1>
            <div className="flex items-center gap-2 border-b bg-background px-3 py-2 text-sm">
                <span className="text-muted-foreground">Scope</span>
                {canViewLocationContacts(access) ? (
                    <>
                        <Link className={conversationScope === 'my' ? 'font-semibold underline' : ''} href="/admin/conversations?scope=my">My assignments</Link>
                        <Link className={conversationScope === 'location' ? 'font-semibold underline' : ''} href="/admin/conversations?scope=location">All location</Link>
                    </>
                ) : (
                    <span className="font-medium">My assignments</span>
                )}
            </div>
            <main className="flex-1 min-h-0 overflow-hidden relative">
                <Suspense fallback={<div>Loading Interface...</div>}>
                    <ConversationInterface
                        locationId={location.id}
                        initialConversations={initialConversationsData.conversations}
                        initialConversationListPageInfo={{
                            hasMore: !!initialConversationsData.hasMore,
                            nextCursor: initialConversationsData.nextCursor || null,
                            deltaCursor: initialConversationsData.deltaCursor || null,
                        }}
                        initialSelectedConversationId={selectedConversationId || null}
                        initialDeals={initialDealsData}
                        featureFlags={featureFlags}
                        scope={conversationScope}
                    />
                </Suspense>
            </main>
        </div>
    );
}
