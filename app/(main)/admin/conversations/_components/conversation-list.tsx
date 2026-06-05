import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WhatsAppStatus } from './whatsapp-status';
import { GlobalTaskList } from './global-task-list';
import { useConversationListControls } from './use-conversation-list-controls';
import { ConversationListHeader } from './conversation-list-header';
import { ConversationListItem } from './conversation-list-item';

interface ConversationListProps {
    conversations: Conversation[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onHoverConversation?: (id: string) => void;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
    // Selection Mode Props
    isSelectionMode?: boolean;
    onToggleSelectionMode?: (enabled: boolean) => void;
    selectedIds?: Set<string>;
    onToggleSelect?: (id: string, checked: boolean) => void;
    onSelectAll?: (select: boolean, ids?: string[]) => void;
    onDelete?: (ids: string[]) => void;

    // Deals Mode Props
    viewMode?: 'chats' | 'deals';
    onViewModeChange?: (mode: 'chats' | 'deals') => void;
    // View Filter Props
    viewFilter?: 'active' | 'archived' | 'trash' | 'tasks';
    onViewFilterChange?: (filter: 'active' | 'archived' | 'trash' | 'tasks') => void;
    deals?: any[];
    onSelectDeal?: (id: string) => void;
    onHoverDeal?: (id: string) => void;
    onImportClick?: () => void;
    onBind?: (ids: string[]) => void;
    onArchive?: (ids: string[]) => void;
    onNewConversationClick?: () => void;
    onSyncAllClick?: () => void;
    onCampaignsClick?: () => void;
    onRestore?: (ids: string[]) => void;
    onEmptyTrash?: () => void;
    selectedTaskId?: string | null;
    onSelectTask?: (taskId: string | null, conversationId?: string | null) => void;
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
    isSearching?: boolean;
    disablePreviewCard?: boolean;
}

export function ConversationList({
    conversations,
    selectedId,
    onSelect,
    onHoverConversation,
    hasMore = false,
    isLoadingMore = false,
    onLoadMore,
    isSelectionMode = false,
    onToggleSelectionMode,
    selectedIds,
    onToggleSelect,
    onSelectAll,
    onDelete,
    viewMode,
    onViewModeChange,
    viewFilter = 'active',
    onViewFilterChange,
    deals,
    onSelectDeal,
    onHoverDeal,
    onImportClick,
    onBind,
    onArchive,
    onRestore,
    onEmptyTrash,
    onNewConversationClick,
    onSyncAllClick,
    onCampaignsClick,
    selectedTaskId = null,
    onSelectTask,
    searchQuery = "",
    onSearchChange,
    isSearching = false,
    disablePreviewCard = false
}: ConversationListProps) {
    const effectiveViewMode = viewMode || 'chats';
    const {
        isMenuOpen,
        setIsMenuOpen,
        isSearchExpanded,
        setIsSearchExpanded,
        localQuery,
        setLocalQuery,
        commitSearch,
        clearSearch,
        handleMouseEnter,
        handleMouseLeave,
        listScrollRef,
        loadMoreSentinelRef,
    } = useConversationListControls({
        conversations,
        searchQuery,
        onSearchChange,
        effectiveViewMode,
        hasMore,
        isLoadingMore,
        onLoadMore,
    });

    const header = (
        <ConversationListHeader
            conversations={conversations}
            selectedIds={selectedIds}
            isSelectionMode={isSelectionMode}
            effectiveViewMode={effectiveViewMode}
            viewFilter={viewFilter}
            searchQuery={searchQuery}
            isSearching={isSearching}
            isSearchExpanded={isSearchExpanded}
            setIsSearchExpanded={setIsSearchExpanded}
            localQuery={localQuery}
            setLocalQuery={setLocalQuery}
            commitSearch={commitSearch}
            clearSearch={clearSearch}
            isMenuOpen={isMenuOpen}
            setIsMenuOpen={setIsMenuOpen}
            handleMouseEnter={handleMouseEnter}
            handleMouseLeave={handleMouseLeave}
            onSelectAll={onSelectAll}
            onToggleSelectionMode={onToggleSelectionMode}
            onBind={onBind}
            onArchive={onArchive}
            onRestore={onRestore}
            onDelete={onDelete}
            onViewModeChange={onViewModeChange}
            onViewFilterChange={onViewFilterChange}
            onEmptyTrash={onEmptyTrash}
            onNewConversationClick={onNewConversationClick}
            onSyncAllClick={onSyncAllClick}
            onCampaignsClick={onCampaignsClick}
            onSearchChange={onSearchChange}
        />
    );

    if (effectiveViewMode === 'deals' && deals && deals.length > 0) {
        // RENDER DEALS LIST
        return (
            <div className="h-full min-h-0 flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                {/* Status Bar */}
                <WhatsAppStatus />

                {/* Unified Header */}
                {header}


                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden sm:pr-1 [scrollbar-gutter:stable] min-w-0">
                    {deals.map(d => (
                        <div
                            key={d.id}
                            data-deal-id={d.id}
                            className={cn(
                                "border-b transition-colors p-2 cursor-pointer hover:bg-slate-50",
                                "bg-slate-50", // Placeholder for logic
                                selectedId === d.id ? "bg-indigo-50 border-l-4 border-l-indigo-500" : "border-l-4 border-l-transparent"
                            )}
                            onClick={() => onSelectDeal?.(d.id)}
                            onMouseEnter={() => onHoverDeal?.(d.id)}
                        >
                            <div className="flex justify-between items-start">
                                <h4 className="font-semibold text-sm truncate text-indigo-900">{d.title}</h4>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${d.stage === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {d.stage}
                                </span>
                            </div>
                            <div className="flex items-center text-xs text-gray-500 mt-1">
                                <Layers className="w-3 h-3 mr-1 opacity-50" />
                                <span>{d.conversationIds?.length || 0} participants</span>
                                <span className="mx-1">•</span>
                                <span>{formatDistanceToNow(new Date(d.lastActivityAt || d.updatedAt), { addSuffix: true })}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }



    if (isSearching) {
        return (
            <div className="h-full min-h-0 flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                <WhatsAppStatus />
                {header}
                <div className="p-8 flex flex-col items-center justify-center text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mb-2" />
                    <p className="text-sm">Searching...</p>
                </div>
            </div>
        );
    }

    if (viewFilter === 'tasks') {
        return (
            <div className="h-full min-h-0 flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                <WhatsAppStatus />
                {header}
                <GlobalTaskList
                    selectedConversationId={selectedId}
                    onSelectConversation={onSelect}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={onSelectTask}
                />
            </div>
        );
    }

    if (conversations.length === 0 && effectiveViewMode === 'chats') {
        return (
            <div className="h-full min-h-0 flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                <WhatsAppStatus />
                {header}
                <div className="p-4 text-center text-gray-500">No conversations found.</div>
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
            {/* Status Bar */}
            <WhatsAppStatus />

            {/* Unified Header with Mode Toggle + Action Buttons */}
            {header}

            <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden sm:pr-1 [scrollbar-gutter:stable] min-w-0">
                {conversations.map((c) => {
                    const isChecked = selectedIds?.has(c.id) || false;

                    return (
                        <div key={c.id}>
                            <ConversationListItem
                                conversation={c}
                                selectedId={selectedId}
                                isSelectionMode={isSelectionMode}
                                isChecked={isChecked}
                                disablePreviewCard={disablePreviewCard}
                                onSelect={onSelect}
                                onToggleSelect={onToggleSelect}
                                onHoverConversation={onHoverConversation}
                            />
                        </div>
                    );
                })}

                {(hasMore || isLoadingMore) && !searchQuery.trim() && (
                    <div className="px-3 py-3 border-t bg-white/80">
                        <div ref={loadMoreSentinelRef} className="h-1 w-full" aria-hidden="true" />
                        <div className="mt-2 flex items-center justify-center">
                            {isLoadingMore ? (
                                <div className="inline-flex items-center gap-2 text-xs text-slate-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading more conversations...
                                </div>
                            ) : hasMore ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-slate-600"
                                    onClick={() => onLoadMore?.()}
                                >
                                    Load more
                                </Button>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
