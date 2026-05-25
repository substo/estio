import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ACTIVE_REFRESH_MESSAGE_LIMIT,
    THREAD_TARGET_MESSAGE_COUNT,
} from '@/lib/conversations/thread-hydration';
import { getActiveWorkspaceRefreshOptions } from './use-conversation-refresh-orchestration';

test('active workspace refresh uses first-paint message options when transcripts are not pending', () => {
    assert.deepEqual(getActiveWorkspaceRefreshOptions({
        pendingTranscripts: false,
        workspaceActivityLimit: 17,
    }), {
        messageLimit: ACTIVE_REFRESH_MESSAGE_LIMIT,
        messageMetadataMode: 'firstPaint',
        includeActivity: false,
        activityLimit: 17,
        refreshMode: 'active_refresh',
    });
});

test('active workspace refresh uses full thread and activity options when transcripts are pending', () => {
    assert.deepEqual(getActiveWorkspaceRefreshOptions({
        pendingTranscripts: true,
        workspaceActivityLimit: 23,
    }), {
        messageLimit: THREAD_TARGET_MESSAGE_COUNT,
        messageMetadataMode: 'full',
        includeActivity: true,
        activityLimit: 23,
        refreshMode: 'active_refresh',
    });
});
