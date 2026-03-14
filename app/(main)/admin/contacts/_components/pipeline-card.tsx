'use client';

import { formatDistanceToNow } from 'date-fns';
import { LeadSourceBadge } from './lead-source-badge';
import { LeadScoreBadge } from './lead-score-badge';
import { Building2, MessageCircle, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EditContactDialog } from './edit-contact-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface PipelineCardProps {
    contact: any;
    leadSources: string[];
    isGoogleConnected: boolean;
    isGhlConnected: boolean;
}

export function PipelineCard({ contact, leadSources, isGoogleConnected, isGhlConnected }: PipelineCardProps) {
    const unreadCount = contact.conversations?.[0]?.unreadCount || 0;

    return (
        <div className="bg-white dark:bg-gray-950 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow hover:border-gray-300 dark:hover:border-gray-700 p-3 group">
            
            <div className="flex justify-between items-start mb-2">
                <div className="font-semibold text-sm truncate pr-2" title={contact.name || 'Unknown'}>
                    {contact.name || 'Unknown'}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {contact.leadPriority === 'High' && (
                        <span className="text-red-500 text-[10px] font-bold tracking-tighter" title="High Priority">
                            HIGH
                        </span>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <MoreHorizontal className="h-3 w-3" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[200px]">
                            {/* Render Edit Dialog cleanly from Dropdown without nesting issues */}
                            <EditContactDialog
                                contact={contact}
                                leadSources={leadSources}
                                isGoogleConnected={isGoogleConnected}
                                isGhlConnected={isGhlConnected}
                            />
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <div className="text-xs text-muted-foreground flex flex-col gap-1.5 mb-3">
                {contact.phone && (
                    <div className="truncate">📞 {contact.phone}</div>
                )}
                {contact.leadGoal && (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-foreground/80">
                        <Building2 className="h-3 w-3" /> 
                        {contact.leadGoal}
                        {contact.requirementStatus && <span className="text-muted-foreground font-normal">({contact.requirementStatus})</span>}
                    </div>
                )}
            </div>

            <div className="flex justify-between items-end mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <div className="flex items-center gap-1.5 flex-wrap">
                    {contact.leadSource && <LeadSourceBadge source={contact.leadSource} size="xs" />}
                    
                    {unreadCount > 0 && (
                        <div className="flex items-center justify-center bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 text-[10px] font-bold" title={`${unreadCount} unread message(s)`}>
                            <MessageCircle className="h-2.5 w-2.5 mr-0.5" />
                            {unreadCount}
                        </div>
                    )}
                </div>

                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <LeadScoreBadge score={contact.leadScore ?? 0} />
                    <span className="text-[10px] text-muted-foreground mt-0.5" title={contact.updatedAt ? new Date(contact.updatedAt).toLocaleString() : ''}>
                        {formatDistanceToNow(new Date(contact.updatedAt || new Date()), { addSuffix: true })}
                    </span>
                </div>
            </div>
            
        </div>
    );
}
