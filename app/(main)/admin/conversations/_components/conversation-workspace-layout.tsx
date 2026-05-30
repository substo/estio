'use client';

import type { ReactNode, RefObject, TouchEventHandler } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { MobilePane } from './use-mobile-conversation-panes';

interface ConversationWorkspaceLayoutProps {
    isMobileViewport: boolean;
    mobilePaneContainerRef: RefObject<HTMLDivElement | null>;
    mobilePaneHostRef: RefObject<HTMLDivElement | null>;
    currentMobilePane: MobilePane;
    mobilePaneHint: string | null;
    mobilePaneContent: Record<MobilePane, ReactNode>;
    handleMobileTouchStart: TouchEventHandler<HTMLDivElement>;
    handleMobileTouchMove: TouchEventHandler<HTMLDivElement>;
    handleMobileTouchEnd: TouchEventHandler<HTMLDivElement>;
    conversationListPane: ReactNode;
    conversationMainPane: ReactNode;
    missionControlPane: ReactNode;
}

export function ConversationWorkspaceLayout({
    isMobileViewport,
    mobilePaneContainerRef,
    mobilePaneHostRef,
    currentMobilePane,
    mobilePaneHint,
    mobilePaneContent,
    handleMobileTouchStart,
    handleMobileTouchMove,
    handleMobileTouchEnd,
    conversationListPane,
    conversationMainPane,
    missionControlPane,
}: ConversationWorkspaceLayoutProps) {
    if (isMobileViewport) {
        return (
            <div
                ref={mobilePaneContainerRef}
                className="relative h-full w-full overflow-hidden touch-pan-y"
                onTouchStart={handleMobileTouchStart}
                onTouchMove={handleMobileTouchMove}
                onTouchEnd={handleMobileTouchEnd}
            >
                <div
                    ref={mobilePaneHostRef}
                    className="h-full w-full min-w-0 max-w-full overflow-x-hidden"
                    data-mobile-pane={currentMobilePane}
                >
                    {mobilePaneContent[currentMobilePane]}
                </div>
                {mobilePaneHint && (
                    <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-900/75 px-3 py-1 text-[10px] font-medium text-white">
                        {mobilePaneHint}
                    </div>
                )}
            </div>
        );
    }

    return (
        <PanelGroup orientation="horizontal" className="h-full w-full max-w-full overflow-hidden">
            {/* Left: List */}
            <Panel
                defaultSize={20}
                minSize={18}
                className="overflow-hidden min-w-0"
            >
                {conversationListPane}
            </Panel>

            <PanelResizeHandle
                className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50 flex flex-col justify-center"
                style={{ width: '2px', cursor: 'col-resize' }}
            />

            {/* Center: Chat */}
            <Panel defaultSize={60} minSize={36} className="overflow-hidden min-w-0">
                {conversationMainPane}
            </Panel>

            <PanelResizeHandle
                className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50"
                style={{ width: '1px', cursor: 'col-resize' }}
            />

            {/* Right: AI Coordinator */}
            <Panel defaultSize={20} minSize={20} className="min-w-0">
                {missionControlPane}
            </Panel>
        </PanelGroup>
    );
}
