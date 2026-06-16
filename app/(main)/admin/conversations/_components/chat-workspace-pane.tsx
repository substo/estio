'use client';

import type { ComponentProps } from 'react';

import { ChatWindow } from './chat-window';

type ChatWindowProps = ComponentProps<typeof ChatWindow>;

interface ChatWorkspacePaneProps extends Omit<ChatWindowProps, 'conversation' | 'onBack' | 'onOpenMissionControl'> {
    activeConversation: ChatWindowProps['conversation'] | null;
    isMobileViewport: boolean;
    onBack: NonNullable<ChatWindowProps['onBack']>;
    onOpenMissionControl: NonNullable<ChatWindowProps['onOpenMissionControl']>;
}

export function ChatWorkspacePane({
    activeConversation,
    isMobileViewport,
    onBack,
    onOpenMissionControl,
    ...chatWindowProps
}: ChatWorkspacePaneProps) {
    if (!activeConversation) {
        return (
            <div className="h-full min-h-0 flex items-center justify-center text-gray-400 bg-slate-50 dark:bg-slate-950 dark:text-slate-500">
                Select a conversation
            </div>
        );
    }

    return (
        <ChatWindow
            key={activeConversation.id}
            conversation={activeConversation}
            onBack={isMobileViewport ? onBack : undefined}
            onOpenMissionControl={isMobileViewport ? onOpenMissionControl : undefined}
            {...chatWindowProps}
        />
    );
}
