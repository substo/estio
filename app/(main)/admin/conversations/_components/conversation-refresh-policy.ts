import { ACTIVE_REFRESH_MESSAGE_LIMIT, THREAD_TARGET_MESSAGE_COUNT } from '@/lib/conversations/thread-hydration';

const CONNECTED_LIST_RECONCILE_INTERVAL_MS = 15_000;
const CONNECTED_ACTIVE_RECONCILE_INTERVAL_MS = 5_000;

export function getActiveWorkspaceRefreshOptions({
    pendingTranscripts,
    workspaceActivityLimit,
}: {
    pendingTranscripts: boolean;
    workspaceActivityLimit: number;
}) {
    return {
        messageLimit: pendingTranscripts ? THREAD_TARGET_MESSAGE_COUNT : ACTIVE_REFRESH_MESSAGE_LIMIT,
        messageMetadataMode: pendingTranscripts ? 'full' : 'firstPaint',
        includeActivity: pendingTranscripts,
        activityLimit: workspaceActivityLimit,
        refreshMode: 'active_refresh',
    } as const;
}

export function getConversationListReconcileIntervalMs(balancedPolling: boolean) {
    return balancedPolling ? CONNECTED_LIST_RECONCILE_INTERVAL_MS : 3_000;
}

export function getActiveConversationReconcileIntervalMs(args: {
    balancedPolling: boolean;
    pendingTranscripts: boolean;
}) {
    return args.balancedPolling ? CONNECTED_ACTIVE_RECONCILE_INTERVAL_MS : 3_000;
}
