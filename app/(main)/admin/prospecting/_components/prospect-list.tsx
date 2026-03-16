'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { type ProspectInboxRow } from '@/lib/leads/prospect-repository';
import { LeadScoreBadge } from '@/app/(main)/admin/contacts/_components/lead-score-badge';
import { LeadSourceBadge } from '@/app/(main)/admin/contacts/_components/lead-source-badge';
import { acceptProspect, rejectProspect } from '../actions';
import { toast } from 'sonner';
import { Check, X, Building2, UserCheck, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export function ProspectList({
    items,
    total,
    selectedId
}: {
    items: ProspectInboxRow[];
    total: number;
    selectedId?: string;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const handleSelect = (id: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('prospectId', id);
        router.push(`?${params.toString()}`);
    };

    const handleAccept = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        startTransition(async () => {
            const res = await acceptProspect(id);
            if (res.success) {
                toast.success('Prospect accepted and converted to Contact');
                if (selectedId === id) {
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('prospectId');
                    router.push(`?${params.toString()}`);
                }
            } else {
                toast.error(res.message);
            }
        });
    };

    const handleReject = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        startTransition(async () => {
            const res = await rejectProspect(id);
            if (res.success) {
                toast.success('Prospect rejected');
                if (selectedId === id) {
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete('prospectId');
                    router.push(`?${params.toString()}`);
                }
            } else {
                toast.error(res.message);
            }
        });
    };

    return (
        <div className="flex flex-col h-full bg-background border-r">
            <div className="p-4 border-b bg-muted/20 flex justify-between items-center shrink-0">
                <h2 className="font-semibold">Leads Inbox</h2>
                <span className="text-xs text-muted-foreground">{total} total</span>
            </div>
            
            <ScrollArea className="flex-1">
                {items.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                        No prospects found.
                    </div>
                ) : (
                    <div className="flex flex-col divide-y">
                        {items.map((item) => {
                            const isSelected = item.id === selectedId;
                            const isNew = item.status === 'new' || item.status === 'reviewing';
                            
                            return (
                                <div 
                                    key={item.id}
                                    onClick={() => handleSelect(item.id)}
                                    className={cn(
                                        "p-4 cursor-pointer hover:bg-muted/50 transition-colors flex flex-col gap-2 relative",
                                        isSelected ? "bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary" : "border-l-2 border-l-transparent",
                                        !isNew && "opacity-70"
                                    )}
                                >
                                    {/* Action Buttons overlaying top right */}
                                    {isNew && (
                                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity sm:opacity-100">
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-7 w-7 bg-background/80 hover:bg-green-100 hover:text-green-700 shadow-sm"
                                                onClick={(e) => handleAccept(e, item.id)}
                                                disabled={isPending}
                                            >
                                                <Check className="w-3.5 h-3.5" />
                                            </Button>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="h-7 w-7 bg-background/80 hover:bg-red-100 hover:text-red-700 shadow-sm"
                                                onClick={(e) => handleReject(e, item.id)}
                                                disabled={isPending}
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    )}

                                    {/* Top Row: Name & Score */}
                                    <div className="flex items-start justify-between pr-16">
                                        <div className="flex items-center gap-2">
                                            {item.isAgency ? <Building2 className="w-4 h-4 text-blue-500 shrink-0" /> : <UserCheck className="w-4 h-4 text-green-500 shrink-0" />}
                                            <span className="font-semibold text-sm truncate">{item.name || 'Unknown Name'}</span>
                                        </div>
                                    </div>

                                    {/* Middle Row: Contact Info & Status */}
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                        <div className="truncate flex-1">
                                            {item.phone || item.email || 'No contact info'}
                                        </div>
                                        {!isNew && (
                                            <Badge variant={item.status === 'accepted' ? 'default' : 'destructive'} className="text-[10px] h-4 px-1 shrink-0">
                                                {item.status.toUpperCase()}
                                            </Badge>
                                        )}
                                        {item.dedupStatus === 'duplicate' && (
                                            <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">DUP</Badge>
                                        )}
                                    </div>

                                    {/* Bottom Row: Source, Score & Listings count */}
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                                        <div className="flex items-center gap-2">
                                            <LeadSourceBadge source={item.source} />
                                            <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                                                <Home className="w-3 h-3" /> {item.scrapedListingsCount}
                                            </div>
                                        </div>
                                        <LeadScoreBadge score={item.aiScore || 0} />
                                    </div>
                                    
                                    <div className="text-[10px] text-muted-foreground/60 absolute bottom-2 right-2">
                                        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}
