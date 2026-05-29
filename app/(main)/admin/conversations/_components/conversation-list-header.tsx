import { Conversation } from "@/lib/ghl/conversations";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Archive, CheckSquare, CloudDownload, Inbox, Layers, Loader2, MessageSquare, MoreHorizontal, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { resolveConversationListWorkflowView } from "./conversation-list-header-state";

interface ConversationListHeaderProps {
    conversations: Conversation[];
    selectedIds?: Set<string>;
    isSelectionMode: boolean;
    effectiveViewMode: 'chats' | 'deals';
    viewFilter: 'active' | 'archived' | 'trash' | 'tasks';
    searchQuery: string;
    isSearching: boolean;
    isSearchExpanded: boolean;
    setIsSearchExpanded: (expanded: boolean) => void;
    localQuery: string;
    setLocalQuery: (query: string) => void;
    commitSearch: (query: string) => void;
    clearSearch: () => void;
    isMenuOpen: boolean;
    setIsMenuOpen: (open: boolean) => void;
    handleMouseEnter: () => void;
    handleMouseLeave: () => void;
    onSelectAll?: (select: boolean, ids?: string[]) => void;
    onToggleSelectionMode?: (enabled: boolean) => void;
    onBind?: (ids: string[]) => void;
    onArchive?: (ids: string[]) => void;
    onRestore?: (ids: string[]) => void;
    onDelete?: (ids: string[]) => void;
    onViewModeChange?: (mode: 'chats' | 'deals') => void;
    onViewFilterChange?: (filter: 'active' | 'archived' | 'trash' | 'tasks') => void;
    onEmptyTrash?: () => void;
    onNewConversationClick?: () => void;
    onSyncAllClick?: () => void;
    onSearchChange?: (q: string) => void;
}

export function ConversationListHeader({
    conversations,
    selectedIds,
    isSelectionMode,
    effectiveViewMode,
    viewFilter,
    searchQuery,
    isSearching,
    isSearchExpanded,
    setIsSearchExpanded,
    localQuery,
    setLocalQuery,
    commitSearch,
    clearSearch,
    isMenuOpen,
    setIsMenuOpen,
    handleMouseEnter,
    handleMouseLeave,
    onSelectAll,
    onToggleSelectionMode,
    onBind,
    onArchive,
    onRestore,
    onDelete,
    onViewModeChange,
    onViewFilterChange,
    onEmptyTrash,
    onNewConversationClick,
    onSyncAllClick,
    onSearchChange,
}: ConversationListHeaderProps) {
    const visibleSelectedCount = conversations.filter((conversation) => selectedIds?.has(conversation.id)).length;
    const isAllSelected = conversations.length > 0 && visibleSelectedCount === conversations.length;
    const isPartiallySelected = visibleSelectedCount > 0 && visibleSelectedCount < conversations.length;
    const selectedIdsList = Array.from(selectedIds || []);
    const workflowView = resolveConversationListWorkflowView(effectiveViewMode, viewFilter);
    const showSearch = workflowView === 'chats' && onSearchChange !== undefined;
    const showChatMailboxControls = workflowView === 'chats' && onViewFilterChange;
    const showChatActions = workflowView === 'chats' && onToggleSelectionMode;
    const showActiveInboxActions = workflowView === 'chats' && viewFilter === 'active';

    if (isSelectionMode && workflowView === 'chats') {
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
                                    commitSearch(localQuery);
                                } else if (e.key === 'Escape') {
                                    clearSearch();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="absolute inset-y-0 right-0 pr-2 flex items-center text-slate-400 hover:text-slate-600"
                            onClick={() => {
                                if (localQuery || searchQuery) {
                                    clearSearch();
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
            <TooltipProvider delayDuration={200}>
                {onViewModeChange && (
                    <Tabs
                        value={workflowView}
                        onValueChange={(value: string) => {
                            if (value === 'deals') {
                                onViewModeChange('deals');
                                return;
                            }

                            onViewModeChange('chats');
                            if (value === 'tasks') {
                                onViewFilterChange?.('tasks');
                                return;
                            }

                            if (viewFilter === 'tasks') {
                                onViewFilterChange?.('active');
                            }
                        }}
                        className="w-full min-w-0"
                    >
                        <TabsList className="grid h-8 w-full grid-cols-3">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <TabsTrigger value="chats" className="h-7 min-w-0 gap-1 px-1.5 text-xs">
                                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                                        <span className="hidden truncate sm:inline">Chats</span>
                                    </TabsTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Chats</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <TabsTrigger value="deals" className="h-7 min-w-0 gap-1 px-1.5 text-xs">
                                        <Layers className="h-3.5 w-3.5 shrink-0" />
                                        <span className="hidden truncate sm:inline">Deals</span>
                                    </TabsTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Deals</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <TabsTrigger value="tasks" className="h-7 min-w-0 gap-1 px-1.5 text-xs">
                                        <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                                        <span className="hidden truncate sm:inline">Tasks</span>
                                    </TabsTrigger>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Tasks</TooltipContent>
                            </Tooltip>
                        </TabsList>
                    </Tabs>
                )}

                <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                        {showSearch && !isSearchExpanded && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-slate-600 hover:text-slate-900 shrink-0"
                                        onClick={() => setIsSearchExpanded(true)}
                                    >
                                        <Search className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">Search Contacts</TooltipContent>
                            </Tooltip>
                        )}

                        {showChatMailboxControls && (
                            <div
                                onMouseEnter={handleMouseEnter}
                                onMouseLeave={handleMouseLeave}
                                className="flex items-center min-w-0"
                            >
                                <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 min-w-0 max-w-[8rem] justify-start gap-1.5 px-2 text-xs text-slate-700"
                                        >
                                            {viewFilter === 'active' && <Inbox className="w-4 h-4 shrink-0" />}
                                            {viewFilter === 'archived' && <Archive className="w-4 h-4 shrink-0" />}
                                            {viewFilter === 'trash' && <Trash2 className="w-4 h-4 shrink-0" />}
                                            <span className="truncate">
                                                {viewFilter === 'active' && 'Inbox'}
                                                {viewFilter === 'archived' && 'Archived'}
                                                {viewFilter === 'trash' && 'Trash'}
                                            </span>
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
                        )}
                    </div>

                    {showChatActions && (
                        <div className="flex items-center gap-1 shrink-0">
                            {viewFilter === 'trash' && onEmptyTrash && conversations.length > 0 && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 text-xs text-red-600 shrink-0 border-red-200 hover:bg-red-50"
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
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="default"
                                                size="icon"
                                                className="h-8 w-8 shrink-0 bg-green-600 text-white hover:bg-green-700"
                                                onClick={onNewConversationClick}
                                            >
                                                <Plus className="w-4 h-4" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">New Conversation</TooltipContent>
                                    </Tooltip>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                <MoreHorizontal className="w-4 h-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-44">
                                            <DropdownMenuItem onClick={onSyncAllClick} className="gap-2">
                                                <CloudDownload className="w-4 h-4" />
                                                Sync WhatsApp
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => onToggleSelectionMode(true)} className="gap-2">
                                                <Layers className="w-4 h-4" />
                                                Bind to Deal
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => onToggleSelectionMode(true)} className="gap-2">
                                                <CheckSquare className="w-4 h-4" />
                                                Select
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="hidden h-8 w-8 xl:inline-flex"
                                                data-selection-mode-toggle="true"
                                                onClick={() => onToggleSelectionMode(true)}
                                            >
                                                <CheckSquare className="w-3.5 h-3.5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">Select / Delete</TooltipContent>
                                    </Tooltip>
                                </>
                            )}

                            {!showActiveInboxActions && (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8"
                                            data-selection-mode-toggle="true"
                                            onClick={() => onToggleSelectionMode(true)}
                                        >
                                            <CheckSquare className="w-3.5 h-3.5" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="bottom">Select / Delete</TooltipContent>
                                </Tooltip>
                            )}
                        </div>
                    )}
                </div>
            </TooltipProvider>

            {showSearch && isSearchExpanded && (
                <div className="relative animate-in slide-in-from-top-1 fade-in duration-200" data-no-pane-swipe>
                    <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                        <Search className="h-3 w-3 text-slate-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search contacts..."
                        autoFocus
                        className="block w-full pl-7 pr-8 py-1.5 text-xs border border-indigo-200 rounded-md leading-5 bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                        value={localQuery}
                        onChange={(e) => setLocalQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                commitSearch(localQuery);
                            } else if (e.key === 'Escape') {
                                clearSearch();
                                setIsSearchExpanded(false);
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
                            if (localQuery || searchQuery) {
                                clearSearch();
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
}
