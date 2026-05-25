import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Mail, MessageSquare, MessageCircle, Layers, Link as LinkIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { ConversationPreviewCard } from "./conversation-preview-card";
import { WhatsAppStatus } from './whatsapp-status';
import { GlobalTaskList } from './global-task-list';
import Link from 'next/link';
import { useConversationListControls } from './use-conversation-list-controls';
import { ConversationListHeader } from './conversation-list-header';

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
    onRestore?: (ids: string[]) => void;
    onEmptyTrash?: () => void;
    selectedTaskId?: string | null;
    onSelectTask?: (taskId: string | null, conversationId?: string | null) => void;
    searchQuery?: string;
    onSearchChange?: (q: string) => void;
    isSearching?: boolean;
    disablePreviewCard?: boolean;
}

/**
 * Map GHL conversation type codes to friendly display names
 */
function getChannelInfo(type: string): { name: string; icon: React.ReactNode; color: string } {
    const typeUpper = type?.toUpperCase() || '';

    if (typeUpper.includes('EMAIL')) {
        return { name: 'Email', icon: <Mail className="w-3 h-3" />, color: 'bg-purple-50 text-purple-600' };
    }
    if (typeUpper.includes('WHATSAPP')) {
        return { name: 'WhatsApp', icon: <MessageCircle className="w-3 h-3" />, color: 'bg-green-50 text-green-600' };
    }
    if (typeUpper.includes('PHONE') || typeUpper.includes('SMS') || typeUpper.includes('CALL')) {
        return { name: 'SMS', icon: <MessageSquare className="w-3 h-3" />, color: 'bg-blue-50 text-blue-600' };
    }
    if (typeUpper.includes('WEBCHAT') || typeUpper.includes('LIVE')) {
        return { name: 'Live Chat', icon: <MessageSquare className="w-3 h-3" />, color: 'bg-orange-50 text-orange-600' };
    }
    // Fallback
    return { name: type || 'Unknown', icon: <MessageSquare className="w-3 h-3" />, color: 'bg-gray-50 text-gray-600' };
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
        onHoverConversation,
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
            onSearchChange={onSearchChange}
        />
    );

    if (effectiveViewMode === 'deals' && deals && deals.length > 0) {
        // RENDER DEALS LIST
        return (
            <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                {/* Status Bar */}
                <WhatsAppStatus />

                {/* Unified Header */}
                {header}


                <div className="flex-1 overflow-y-auto overflow-x-hidden sm:pr-1 [scrollbar-gutter:stable] min-w-0">
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
            <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
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
            <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
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
            <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                <WhatsAppStatus />
                {header}
                <div className="p-4 text-center text-gray-500">No conversations found.</div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
            {/* Status Bar */}
            <WhatsAppStatus />

            {/* Unified Header with Mode Toggle + Action Buttons */}
            {header}

            <div ref={listScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden sm:pr-1 [scrollbar-gutter:stable] min-w-0">
                {conversations.map((c) => {
                    const channel = getChannelInfo(c.lastMessageType || c.type);
                    const isChecked = selectedIds?.has(c.id);
                    const row = (
                        <div
                            data-conversation-id={c.id}
                            className={cn(
                                "border-b transition-colors flex items-start py-2 pl-2 pr-3 cursor-pointer w-full min-w-0",
                                selectedId === c.id && !isSelectionMode ? "bg-slate-100 border-l-blue-500" : "border-l-transparent",
                                isSelectionMode && isChecked ? "bg-indigo-50" : "hover:bg-slate-50",
                                selectedId === c.id ? "border-l-4" : "border-l-4"
                            )}
                            // In Selection Mode, clicking the row toggles selection (UX choice)
                            // OR clicking the row still selects it for view, but clicking Checkbox selects for action.
                            // Usually Select Mode implies clicking row selects for action.
                            onClick={() => {
                                if (isSelectionMode && onToggleSelect) {
                                    onToggleSelect(c.id, !isChecked);
                                } else {
                                    onSelect(c.id);
                                }
                            }}
                            onMouseEnter={() => onHoverConversation?.(c.id)}
                        >
                            {/* Checkbox for Selection Mode */}
                            {isSelectionMode && onToggleSelect && (
                                <div
                                    className="mr-3 pt-1"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Checkbox
                                        checked={isChecked}
                                        onCheckedChange={(checked: boolean | string) => onToggleSelect(c.id, checked === true)}
                                    />
                                </div>
                            )}

                            <div className="flex-1 min-w-0 w-0 overflow-hidden">
                                {/* Contact name */}
                                <div className="flex items-center justify-between gap-2 min-w-0">
                                    <h4 className="block w-full min-w-0 flex-1 truncate font-semibold text-sm">
                                        {c.contactName || c.contactId || "Unknown Contact"}
                                    </h4>
                                    <div className="ml-2 mr-0.5 flex-none shrink-0 flex items-center gap-1">
                                        {c.unreadCount > 0 && (
                                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] leading-[18px] text-center font-semibold">
                                                {c.unreadCount > 99 ? "99+" : c.unreadCount}
                                            </span>
                                        )}
                                        {(c as any).activeDealId && (
                                            <div title={`Linked to Deal: ${(c as any).activeDealTitle}`}>
                                                <LinkIcon className="h-3 w-3 text-indigo-500" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {/* Channel icon */}
                                <div className="flex items-center gap-1 mt-1">
                                    {channel.icon}
                                    <span className="text-[10px] text-gray-500">{channel.name}</span>
                                </div>
                            </div>
                        </div>
                    );

                    return (
                        <div key={c.id}>
                            {disablePreviewCard ? row : (
                                <HoverCard openDelay={300} closeDelay={100}>
                                    <HoverCardTrigger asChild>
                                        {row}
                                    </HoverCardTrigger>
                                    <HoverCardContent
                                        side="right"
                                        align="start"
                                        sideOffset={8}
                                        className="w-80 p-0"
                                    >
                                        <ConversationPreviewCard conversation={c} />
                                    </HoverCardContent>
                                </HoverCard>
                            )}
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
