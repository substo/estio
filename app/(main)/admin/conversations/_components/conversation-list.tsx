import { useEffect, useState, useRef } from 'react';
import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Mail, MessageSquare, MessageCircle, Layers, Link as LinkIcon, Trash2, X, CheckSquare, Inbox, Archive, Plus, CloudDownload, Loader2, Search, MoreHorizontal, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConversationPreviewCard } from "./conversation-preview-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { WhatsAppStatus } from './whatsapp-status';
import { GlobalTaskList } from './global-task-list';
import Link from 'next/link';

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
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSearchExpanded, setIsSearchExpanded] = useState(!!searchQuery);
    const [localQuery, setLocalQuery] = useState(searchQuery || "");
    const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setLocalQuery(searchQuery || "");
        if (searchQuery) setIsSearchExpanded(true);
    }, [searchQuery]);
    const listScrollRef = useRef<HTMLDivElement | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    const handleMouseEnter = () => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
        setIsMenuOpen(true);
    };

    const handleMouseLeave = () => {
        closeTimeoutRef.current = setTimeout(() => {
            setIsMenuOpen(false);
            closeTimeoutRef.current = null;
        }, 150);
    };

    const effectiveViewMode = viewMode || 'chats';

    useEffect(() => {
        if (effectiveViewMode !== 'chats') return;
        if (!hasMore || isLoadingMore || !onLoadMore) return;
        if (!listScrollRef.current || !loadMoreSentinelRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    onLoadMore();
                }
            },
            {
                root: listScrollRef.current,
                rootMargin: '200px 0px',
                threshold: 0.01,
            }
        );

        observer.observe(loadMoreSentinelRef.current);
        return () => observer.disconnect();
    }, [effectiveViewMode, hasMore, isLoadingMore, onLoadMore, conversations.length]);

    useEffect(() => {
        if (effectiveViewMode !== 'chats') return;
        if (!onHoverConversation) return;
        if (!listScrollRef.current) return;

        const seen = new Set<string>();
        const root = listScrollRef.current;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    const id = (entry.target as HTMLElement).getAttribute('data-conversation-id');
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    onHoverConversation(id);
                }
            },
            {
                root,
                rootMargin: '600px 0px',
                threshold: 0.01,
            }
        );

        const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-conversation-id]')).slice(0, 20);
        rows.forEach((row) => observer.observe(row));
        return () => observer.disconnect();
    }, [effectiveViewMode, conversations, onHoverConversation]);

    // Unified Header Component - used in both modes
    const renderUnifiedHeader = () => {
        const visibleSelectedCount = conversations.filter((conversation) => selectedIds?.has(conversation.id)).length;
        const isAllSelected = conversations.length > 0 && visibleSelectedCount === conversations.length;
        const isPartiallySelected = visibleSelectedCount > 0 && visibleSelectedCount < conversations.length;
        const selectedIdsList = Array.from(selectedIds || []);
        const showSearch = effectiveViewMode === 'chats' && onSearchChange !== undefined;
        const showActiveInboxActions = viewFilter === 'active';

        if (isSelectionMode && effectiveViewMode === 'chats') {
            const visibleConversationIds = conversations.map((conversation) => conversation.id);
            const hasActiveSearch = !!searchQuery.trim();

            return (
                <div className="border-b bg-indigo-50/50 p-2 min-w-0 space-y-2">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <Checkbox
                                id="select-all"
                                checked={isAllSelected || (isPartiallySelected ? "indeterminate" : false)}
                                onCheckedChange={(checked) => onSelectAll?.(checked === true, visibleConversationIds)}
                            />
                            <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-indigo-900">
                                    {selectedIds?.size || 0} selected
                                </div>
                                {hasActiveSearch && (
                                    <div className="truncate text-[10px] text-indigo-700/70">
                                        Showing {conversations.length} search result{conversations.length === 1 ? "" : "s"}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                            <div className="hidden sm:flex items-center gap-0">
                                {onBind && (
                                    <TooltipProvider delayDuration={200}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                                                    data-bind-deal-action="true"
                                                    onClick={() => onBind(selectedIdsList)}
                                                >
                                                    <Layers className="w-4 h-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Bind to New Deal</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {onArchive && (
                                    <TooltipProvider delayDuration={200}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                                                    onClick={() => onArchive(selectedIdsList)}
                                                >
                                                    <Archive className="w-4 h-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Archive Selected</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                {viewFilter === 'trash' && onRestore && (
                                    <TooltipProvider delayDuration={200}>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                    onClick={() => onRestore(selectedIdsList)}
                                                >
                                                    <RotateCcw className="w-4 h-4" />
                                                </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Restore Selected</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}

                                <TooltipProvider delayDuration={200}>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => onDelete?.(selectedIdsList)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Delete Selected</TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>

                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                    {onBind && (
                                        <DropdownMenuItem onClick={() => onBind(selectedIdsList)} className="gap-2">
                                            <Layers className="w-4 h-4" />
                                            Bind to Deal
                                        </DropdownMenuItem>
                                    )}
                                    {onArchive && (
                                        <DropdownMenuItem onClick={() => onArchive(selectedIdsList)} className="gap-2">
                                            <Archive className="w-4 h-4" />
                                            Archive Selected
                                        </DropdownMenuItem>
                                    )}
                                    {viewFilter === 'trash' && onRestore && (
                                        <DropdownMenuItem onClick={() => onRestore(selectedIdsList)} className="gap-2">
                                            <RotateCcw className="w-4 h-4" />
                                            Restore Selected
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem onClick={() => onDelete?.(selectedIdsList)} className="gap-2 text-red-600 focus:text-red-600">
                                        <Trash2 className="w-4 h-4" />
                                        Delete Selected
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>

                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => onToggleSelectionMode?.(false)}>
                                Cancel
                            </Button>
                        </div>
                    </div>

                    {showSearch && (
                        <div className="relative" data-no-pane-swipe>
                            <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                                {isSearching ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                                ) : (
                                    <Search className="h-3 w-3 text-indigo-400" />
                                )}
                            </div>
                            <input
                                type="text"
                                placeholder="Search contacts to add..."
                                className="block w-full pl-7 pr-8 py-1.5 text-xs border border-indigo-200 rounded-md leading-5 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                value={localQuery}
                                onChange={(e) => setLocalQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        onSearchChange?.(localQuery);
                                    } else if (e.key === 'Escape') {
                                        setLocalQuery("");
                                        onSearchChange?.("");
                                    }
                                }}
                            />
                            <button
                                type="button"
                                className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-600"
                                onClick={() => {
                                    if (localQuery || searchQuery) {
                                        setLocalQuery("");
                                        onSearchChange?.("");
                                    }
                                }}
                                aria-label="Clear contact search"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="border-b bg-slate-50 p-2 min-w-0 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-1 min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                        {showSearch && !isSearchExpanded && (
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-slate-600 hover:text-slate-900 shrink-0"
                                onClick={() => setIsSearchExpanded(true)}
                                title="Search Contacts"
                            >
                                <Search className="w-4 h-4" />
                            </Button>
                        )}
                        {onViewModeChange && (
                            <Tabs value={effectiveViewMode} onValueChange={(v: string) => onViewModeChange(v as 'chats' | 'deals')} className="shrink-0">
                                <TabsList className="h-8">
                                    <TabsTrigger value="chats" className="text-xs px-1.5 sm:px-2 h-7 gap-1" title="Chats">
                                        <MessageSquare className="w-3 h-3" />
                                        <span className="hidden sm:inline">Chats</span>
                                    </TabsTrigger>
                                    <TabsTrigger value="deals" className="text-xs px-1.5 sm:px-2 h-7 gap-1" title="Deals">
                                        <Layers className="w-3 h-3" />
                                        <span className="hidden sm:inline">Deals</span>
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>
                        )}

                        {effectiveViewMode === 'chats' && onViewFilterChange && (
                            <TooltipProvider delayDuration={200}>
                                <div
                                    onMouseEnter={handleMouseEnter}
                                    onMouseLeave={handleMouseLeave}
                                    className="flex items-center"
                                >
                                    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-slate-600 hover:text-slate-900"
                                            >
                                                {viewFilter === 'active' && <Inbox className="w-4 h-4" />}
                                                {viewFilter === 'archived' && <Archive className="w-4 h-4" />}
                                                {viewFilter === 'trash' && <Trash2 className="w-4 h-4" />}
                                                {viewFilter === 'tasks' && <CheckSquare className="w-4 h-4 text-emerald-600" />}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="start"
                                            className="w-32"
                                            onMouseEnter={handleMouseEnter}
                                            onMouseLeave={handleMouseLeave}
                                        >
                                            <DropdownMenuItem onClick={() => { onViewFilterChange('active'); setIsMenuOpen(false); }} className="gap-2">
                                                <Inbox className="w-4 h-4" /> Inbox
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { onViewFilterChange('tasks'); setIsMenuOpen(false); }} className="gap-2">
                                                <CheckSquare className="w-4 h-4 text-emerald-600" /> Tasks
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => { onViewFilterChange('archived'); setIsMenuOpen(false); }} className="gap-2">
                                                <Archive className="w-4 h-4" /> Archived
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onClick={() => { onViewFilterChange('trash'); setIsMenuOpen(false); }} className="gap-2 text-red-600 focus:text-red-600">
                                                <Trash2 className="w-4 h-4" /> Trash
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            </TooltipProvider>
                        )}
                    </div>

                    {effectiveViewMode === 'chats' && onToggleSelectionMode && (
                        <TooltipProvider delayDuration={200}>
                            <div className="flex items-center gap-0.5 shrink-0">
                                {viewFilter === 'trash' && onEmptyTrash && conversations.length > 0 && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs text-red-600 shrink-0 border-red-200 hover:bg-red-50"
                                                onClick={onEmptyTrash}
                                            >
                                                Empty Trash
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">Permanently delete all items in trash</TooltipContent>
                                    </Tooltip>
                                )}
                                {showActiveInboxActions && (
                                    <>
                                        <div className="hidden sm:flex items-center gap-0.5">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                                                        onClick={onNewConversationClick}
                                                    >
                                                        <Plus className="w-4 h-4" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">New Conversation</TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        onClick={onSyncAllClick}
                                                    >
                                                        <CloudDownload className="w-3.5 h-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">Sync All WhatsApp Chats</TooltipContent>
                                            </Tooltip>

                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7"
                                                        data-selection-mode-toggle="true"
                                                        onClick={() => onToggleSelectionMode(true)}
                                                    >
                                                        <Layers className="w-3.5 h-3.5" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent side="bottom">Bind to Deal</TooltipContent>
                                            </Tooltip>
                                        </div>

                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-7 w-7 sm:hidden">
                                                    <MoreHorizontal className="w-4 h-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-44">
                                                <DropdownMenuItem onClick={onNewConversationClick} className="gap-2">
                                                    <Plus className="w-4 h-4" />
                                                    New Conversation
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={onSyncAllClick} className="gap-2">
                                                    <CloudDownload className="w-4 h-4" />
                                                    Sync All WhatsApp Chats
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => onToggleSelectionMode(true)} className="gap-2">
                                                    <Layers className="w-4 h-4" />
                                                    Bind to Deal
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </>
                                )}

                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            data-selection-mode-toggle="true"
                                            onClick={() => onToggleSelectionMode(true)}
                                        >
                                            <CheckSquare className="w-3.5 h-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Select / Delete</TooltipContent>
                                </Tooltip>
                            </div>
                        </TooltipProvider>
                    )}
                </div>

                {showSearch && isSearchExpanded && (
                    <div className="relative animate-in slide-in-from-top-1 fade-in duration-200" data-no-pane-swipe>
                        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                            <Search className="h-3 w-3 text-slate-400" />
                        </div>
                        <input
                            type="text"
                            placeholder="Search contacts on Enter..."
                            autoFocus
                            className="block w-full pl-7 pr-8 py-1.5 text-xs border border-indigo-200 rounded-md leading-5 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                            value={localQuery}
                            onChange={(e) => setLocalQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    onSearchChange?.(localQuery);
                                } else if (e.key === 'Escape') {
                                    setIsSearchExpanded(false);
                                    setLocalQuery(searchQuery || "");
                                }
                            }}
                            onBlur={() => {
                                if (!localQuery && !searchQuery) {
                                    setIsSearchExpanded(false);
                                }
                            }}
                        />
                        <button
                            className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-600"
                            onClick={() => {
                                if (localQuery) {
                                    setLocalQuery("");
                                    onSearchChange?.("");
                                } else {
                                    setIsSearchExpanded(false);
                                }
                            }}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                )}
            </div>
        );
    };

    if (effectiveViewMode === 'deals' && deals && deals.length > 0) {
        // RENDER DEALS LIST
        return (
            <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
                {/* Status Bar */}
                <WhatsAppStatus />

                {/* Unified Header */}
                {renderUnifiedHeader()}


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
                {renderUnifiedHeader()}
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
                {renderUnifiedHeader()}
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
                {renderUnifiedHeader()}
                <div className="p-4 text-center text-gray-500">No conversations found.</div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col border-r min-w-0 w-full max-w-full overflow-x-hidden">
            {/* Status Bar */}
            <WhatsAppStatus />

            {/* Unified Header with Mode Toggle + Action Buttons */}
            {renderUnifiedHeader()}

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
