import { useState, useRef } from 'react';
import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Mail, MessageSquare, MessageCircle, Layers, Link as LinkIcon, Upload, Trash2, X, CheckSquare, Inbox, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConversationPreviewCard } from "./conversation-preview-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { WhatsAppStatus } from './whatsapp-status';
import Link from 'next/link';

interface ConversationListProps {
    conversations: Conversation[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    // Selection Mode Props
    isSelectionMode?: boolean;
    onToggleSelectionMode?: (enabled: boolean) => void;
    selectedIds?: Set<string>;
    onToggleSelect?: (id: string, checked: boolean) => void;
    onSelectAll?: (select: boolean) => void;
    onDelete?: (ids: string[]) => void;

    // Deals Mode Props
    viewMode?: 'chats' | 'deals';
    onViewModeChange?: (mode: 'chats' | 'deals') => void;
    // View Filter Props
    viewFilter?: 'active' | 'archived' | 'trash';
    onViewFilterChange?: (filter: 'active' | 'archived' | 'trash') => void;
    deals?: any[];
    onSelectDeal?: (id: string) => void;
    onImportClick?: () => void;
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
    onImportClick
}: ConversationListProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    // Unified Header Component - used in both modes
    const UnifiedHeader = () => {
        const isAllSelected = conversations.length > 0 && selectedIds?.size === conversations.length;
        const isPartiallySelected = selectedIds && selectedIds.size > 0 && selectedIds.size < conversations.length;

        // Selection Mode Header
        if (isSelectionMode && effectiveViewMode === 'chats') {
            return (
                <div className="p-2 border-b bg-indigo-50/50 flex items-center justify-start gap-1 h-[50px] overflow-hidden">
                    <div className="flex items-center gap-2 pl-1 shrink-0">
                        <Checkbox
                            id="select-all"
                            checked={isAllSelected || (isPartiallySelected ? "indeterminate" : false)}
                            onCheckedChange={(checked) => onSelectAll?.(checked === true)}
                        />
                        <span className="text-xs font-medium text-indigo-900 truncate">
                            {selectedIds?.size || 0} selected
                        </span>
                    </div>

                    <div className="flex items-center gap-0 shrink-0 ml-2">
                        {/* Actions for selection mode */}
                        <TooltipProvider delayDuration={200}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                        onClick={() => onDelete?.(Array.from(selectedIds || []))}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete Selected</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>

                    <div className="ml-1">
                        <Button variant="ghost" size="sm" onClick={() => onToggleSelectionMode?.(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            );
        }

        // Standard Header with Mode Toggle + Filter + Actions
        return (
            <div className="p-2 border-b bg-slate-50 flex items-center justify-start gap-1 h-[50px] overflow-hidden">
                {/* Segmented Control for Mode Toggle */}
                {onViewModeChange && (
                    <Tabs value={effectiveViewMode} onValueChange={(v: string) => onViewModeChange(v as 'chats' | 'deals')} className="flex-shrink-0">
                        <TabsList className="h-8">
                            <TabsTrigger value="chats" className="text-xs px-2 h-7 gap-1">
                                <MessageSquare className="w-3 h-3" /> Chats
                            </TabsTrigger>
                            <TabsTrigger value="deals" className="text-xs px-2 h-7 gap-1">
                                <Layers className="w-3 h-3" /> Deals
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                )}

                {/* View Filter Icon Buttons - only show in Chats mode */}
                {effectiveViewMode === 'chats' && onViewFilterChange && (
                    <TooltipProvider delayDuration={200}>
                        <div className="flex items-center gap-1">
                            {/* Vertical Dropdown Toggle - Hoverable */}
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
                                            className="h-7 w-7 text-slate-600 hover:text-slate-900 mx-0.5"
                                        >
                                            {viewFilter === 'active' && <Inbox className="w-4 h-4" />}
                                            {viewFilter === 'archived' && <Archive className="w-4 h-4" />}
                                            {viewFilter === 'trash' && <Trash2 className="w-4 h-4" />}
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
                        </div>
                    </TooltipProvider>
                )}

                {/* Action Buttons - only show in Chats mode */}
                {effectiveViewMode === 'chats' && onToggleSelectionMode && (
                    <TooltipProvider delayDuration={200}>
                        <div className="flex gap-0 shrink-0">
                            {/* Import & Bind - only show on Inbox */}
                            {viewFilter === 'active' && (
                                <>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={onImportClick}
                                            >
                                                <Upload className="w-3.5 h-3.5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">Import WhatsApp</TooltipContent>
                                    </Tooltip>

                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => onToggleSelectionMode(true)}
                                            >
                                                <Layers className="w-3.5 h-3.5" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent side="bottom">Bind to Deal</TooltipContent>
                                    </Tooltip>
                                </>
                            )}

                            {/* Select/Delete - always shown in Chats mode */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
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
        );
    };

    if (effectiveViewMode === 'deals' && deals && deals.length > 0) {
        // RENDER DEALS LIST
        return (
            <div className="h-full flex flex-col border-r">
                {/* Status Bar */}
                <WhatsAppStatus />

                {/* Unified Header */}
                <UnifiedHeader />


                <div className="flex-1 overflow-y-auto">
                    {deals.map(d => (
                        <div
                            key={d.id}
                            className={cn(
                                "border-b transition-colors p-2 cursor-pointer hover:bg-slate-50",
                                "bg-slate-50", // Placeholder for logic
                                selectedId === d.id ? "bg-indigo-50 border-l-4 border-l-indigo-500" : "border-l-4 border-l-transparent"
                            )}
                            onClick={() => onSelectDeal?.(d.id)}
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

    if (conversations.length === 0 && effectiveViewMode === 'chats') {
        return (
            <div className="h-full flex flex-col border-r">
                <WhatsAppStatus />
                <UnifiedHeader />
                <div className="p-4 text-center text-gray-500">No conversations found.</div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col border-r">
            {/* Status Bar */}
            <WhatsAppStatus />

            {/* Unified Header with Mode Toggle + Action Buttons */}
            <UnifiedHeader />

            <div className="flex-1 overflow-y-auto">
                {conversations.map((c) => {
                    const channel = getChannelInfo(c.lastMessageType || c.type);
                    const isChecked = selectedIds?.has(c.id);

                    return (
                        <div key={c.id}>
                            <HoverCard openDelay={300} closeDelay={100}>
                                <HoverCardTrigger asChild>
                                    <div
                                        className={cn(
                                            "border-b transition-colors flex items-start p-2 cursor-pointer",
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

                                        <div className="flex-1 min-w-0">
                                            {/* Contact name */}
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-semibold text-sm truncate flex-1">
                                                    {c.contactName || c.contactId || "Unknown Contact"}
                                                </h4>
                                                {(c as any).activeDealId && (
                                                    <div title={`Linked to Deal: ${(c as any).activeDealTitle}`} className="ml-1">
                                                        <LinkIcon className="h-3 w-3 text-indigo-500" />
                                                    </div>
                                                )}
                                            </div>
                                            {/* Channel icon */}
                                            <div className="flex items-center gap-1 mt-1">
                                                {channel.icon}
                                                <span className="text-[10px] text-gray-500">{channel.name}</span>
                                            </div>
                                        </div>
                                    </div>
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
                        </div>
                    );
                })}
            </div>
        </div>
    );
}


