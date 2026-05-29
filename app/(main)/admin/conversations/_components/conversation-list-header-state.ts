export type ConversationListWorkflowView = 'chats' | 'deals' | 'tasks';

export function resolveConversationListWorkflowView(
    effectiveViewMode: 'chats' | 'deals',
    viewFilter: 'active' | 'archived' | 'trash' | 'tasks'
): ConversationListWorkflowView {
    if (effectiveViewMode === 'deals') return 'deals';
    if (viewFilter === 'tasks') return 'tasks';
    return 'chats';
}
