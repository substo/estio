'use client';

import { useState, useOptimistic, useTransition, useEffect } from 'react';
import { LEAD_STAGES } from './contact-types';
import { PipelineCard } from './pipeline-card';
import { updateContactStage } from '../actions';
import { ContactData } from './contact-form';

const STAGE_COLORS: Record<string, string> = {
    Unassigned: 'bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-700',
    New: 'bg-blue-50 border-blue-300 dark:bg-blue-900/20 dark:border-blue-800',
    Contacted: 'bg-cyan-50 border-cyan-300 dark:bg-cyan-900/20 dark:border-cyan-800',
    Viewing: 'bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-800',
    Negotiation: 'bg-orange-50 border-orange-300 dark:bg-orange-900/20 dark:border-orange-800',
    Closed: 'bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-800',
    Lost: 'bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-800',
};

interface PipelineBoardProps {
    contacts: any[]; // Matches the shape passed down from page.tsx 
    stageCounts?: { leadStage: string | null; _count: number }[] | null;
    leadSources: string[];
    isGoogleConnected: boolean;
    isGhlConnected: boolean;
}

export function PipelineBoard({ contacts, stageCounts, leadSources, isGoogleConnected, isGhlConnected }: PipelineBoardProps) {
    const [isPending, startTransition] = useTransition();

    // Use optimistic state for instant UI feedback on drop 
    const [optimisticContacts, setOptimisticContacts] = useOptimistic(
        contacts,
        (state: any[], update: { id: string; newStage: string }) => {
            return state.map(contact => 
                contact.id === update.id 
                    ? { ...contact, leadStage: update.newStage } 
                    : contact
            );
        }
    );

    // Group contacts by stage
    const grouped = LEAD_STAGES.reduce((acc, stage) => {
        acc[stage] = optimisticContacts.filter((c: any) => (c.leadStage || 'Unassigned') === stage);
        return acc;
    }, {} as Record<string, any[]>);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, contactId: string) => {
        e.dataTransfer.setData('contactId', contactId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); // allow drop
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetStage: string) => {
        e.preventDefault();
        const contactId = e.dataTransfer.getData('contactId');
        if (!contactId) return;

        // Skip if dropping in same stage
        const draggedContact = optimisticContacts.find(c => c.id === contactId);
        if (draggedContact && (draggedContact.leadStage || 'Unassigned') === targetStage) {
            return;
        }

        // Apply optimistic update immediately
        startTransition(() => {
            setOptimisticContacts({ id: contactId, newStage: targetStage });
        });

        // Fire server action in background without awaiting layout block
        updateContactStage(contactId, targetStage).catch(err => {
            console.error('Failed to update contact stage:', err);
            // In a real app we might trigger a toast or rollback state here
        });
    };

    return (
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[65vh] select-none">
            {LEAD_STAGES.map(stage => (
                <div 
                    key={stage} 
                    className={`flex-shrink-0 w-[300px] flex flex-col rounded-xl border-2 ${STAGE_COLORS[stage]} shadow-sm`}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, stage)}
                >
                    <div className="p-3 font-semibold text-sm border-b flex justify-between items-center bg-white/50 dark:bg-black/20 rounded-t-lg">
                        <span className="uppercase tracking-wider text-xs">{stage}</span>
                        <div className="bg-white dark:bg-gray-900 border px-2 py-0.5 rounded-full text-xs text-muted-foreground font-medium">
                            {grouped[stage].length}
                        </div>
                    </div>
                    
                    <div className="p-3 flex flex-col gap-3 flex-1 overflow-y-auto max-h-[70vh] custom-scrollbar">
                        {grouped[stage].map(contact => (
                            <div 
                                key={contact.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, contact.id)}
                            >
                                <PipelineCard 
                                    contact={contact} 
                                    leadSources={leadSources}
                                    isGoogleConnected={isGoogleConnected}
                                    isGhlConnected={isGhlConnected}
                                />
                            </div>
                        ))}
                        {grouped[stage].length === 0 && (
                            <div className="h-full flex items-center justify-center text-xs text-muted-foreground italic opacity-50 border-2 border-dashed border-transparent hover:border-gray-300 dark:hover:border-gray-700 rounded-lg transition-colors p-4">
                                Drop lead here
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
