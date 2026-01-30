import { Suspense } from 'react';
import { getLocationContext } from '@/lib/auth/location-context';
import { fetchConversations } from './actions';
import { ConversationInterface } from './_components/conversation-interface';
import { hasScopesForFeature, getMissingScopes, describeMissingScopes } from '@/lib/ghl/scope-validator';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

// Force dynamic because we fetch real-time data
export const dynamic = 'force-dynamic';

export default async function ConversationsPage() {
    const location = await getLocationContext();

    if (!location) {
        return <div className="p-8">Unauthorized. Please login.</div>;
    }

    if (!location.ghlAccessToken) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-bold mb-4">GoHighLevel Not Connected</h2>
                <p>Please connect your GoHighLevel account in Settings to access Conversations.</p>
            </div>
        );
    }

    // Check if location has required scopes for conversations
    console.log('[Conversations Debug] location.id:', location.id, 'ghlLocationId:', location.ghlLocationId);
    console.log('[Conversations Debug] location.ghlScopes:', location.ghlScopes);
    const hasConversationScopes = hasScopesForFeature(location.ghlScopes, 'conversations');
    console.log('[Conversations Debug] hasConversationScopes:', hasConversationScopes);

    if (!hasConversationScopes) {
        const missingScopes = getMissingScopes(location.ghlScopes, 'conversations');
        const description = describeMissingScopes(missingScopes);

        return (
            <div className="h-[calc(100vh-64px)] flex items-center justify-center p-8">
                <div className="max-w-md text-center space-y-4">
                    <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center">
                        <AlertTriangle className="w-8 h-8 text-amber-600" />
                    </div>
                    <h2 className="text-xl font-bold">Reconnection Required</h2>
                    <p className="text-muted-foreground">
                        Your GoHighLevel app needs additional permissions to access Conversations.
                    </p>
                    <p className="text-sm text-muted-foreground bg-slate-100 p-2 rounded">
                        {description}
                    </p>
                    <Button asChild className="mt-4">
                        <Link href="/api/oauth/start">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Reconnect GoHighLevel
                        </Link>
                    </Button>
                    <p className="text-xs text-muted-foreground">
                        This will open a popup to grant the new permissions.
                    </p>
                </div>
            </div>
        );
    }

    // Initial Fetch on Server
    const { conversations } = await fetchConversations('all');

    return (
        <div className="h-[calc(100vh-64px)] w-full max-w-full min-w-0 overflow-hidden flex flex-col">


            <main className="flex-1 overflow-hidden relative">
                <Suspense fallback={<div>Loading Interface...</div>}>
                    <ConversationInterface initialConversations={conversations} />
                </Suspense>
            </main>
        </div>
    );
}

