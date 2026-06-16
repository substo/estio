'use client';

import type { ReactNode, RefObject } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { MobilePane } from './use-mobile-conversation-panes';

interface ConversationWorkspaceLayoutProps {
    isMobileViewport: boolean;
    mobilePaneHostRef: RefObject<HTMLDivElement | null>;
    currentMobilePane: MobilePane;
    mobilePaneContent: Record<MobilePane, ReactNode>;
    conversationListPane: ReactNode;
    conversationMainPane: ReactNode;
    missionControlPane: ReactNode;
}

export function ConversationWorkspaceLayout({
    isMobileViewport,
    mobilePaneHostRef,
    currentMobilePane,
    mobilePaneContent,
    conversationListPane,
    conversationMainPane,
    missionControlPane,
}: ConversationWorkspaceLayoutProps) {
    if (isMobileViewport) {
        return (
            <div className="relative h-full min-h-0 w-full overflow-hidden">
                <div
                    ref={mobilePaneHostRef}
                    className="h-full min-h-0 w-full min-w-0 max-w-full overflow-x-hidden"
                    data-mobile-pane={currentMobilePane}
                >
                    {mobilePaneContent[currentMobilePane]}
                </div>
            </div>
        );
    }

    return (
        <PanelGroup orientation="horizontal" className="h-full min-h-0 w-full max-w-full overflow-hidden">
            {/* Left: List */}
            <Panel
                defaultSize={20}
                minSize={18}
                className="overflow-hidden min-w-0"
            >
                {conversationListPane}
            </Panel>

            <PanelResizeHandle
                className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50 flex flex-col justify-center dark:bg-slate-800 dark:hover:bg-blue-500"
                style={{ width: '2px', cursor: 'col-resize' }}
            />

            {/* Center: Chat */}
            <Panel defaultSize={60} minSize={36} className="overflow-hidden min-w-0">
                {conversationMainPane}
            </Panel>

            <PanelResizeHandle
                className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50 dark:bg-slate-800 dark:hover:bg-blue-500"
                style={{ width: '1px', cursor: 'col-resize' }}
            />

            {/* Right: AI Coordinator */}
            <Panel defaultSize={20} minSize={20} className="min-w-0">
                {missionControlPane}
            </Panel>
        </PanelGroup>
    );
}
