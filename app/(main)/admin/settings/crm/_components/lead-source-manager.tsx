'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { addLeadSource, toggleLeadSource } from '../actions';
import { toast } from 'sonner';

type LeadSource = {
    id: string;
    name: string;
    isActive: boolean;
};

interface LeadSourceManagerProps {
    initialSources: LeadSource[];
}

export function LeadSourceManager({ initialSources }: LeadSourceManagerProps) {
    const [sources, setSources] = useState(initialSources);
    const [newSource, setNewSource] = useState('');
    const [isPending, startTransition] = useTransition();

    const handleAdd = () => {
        if (!newSource.trim()) return;

        startTransition(async () => {
            const result = await addLeadSource(newSource);
            if (result.success && result.source) {
                setSources([...sources, result.source]);
                setNewSource('');
                toast.success('Lead Source added');
            } else {
                toast.error(result.message || 'Failed to add source');
            }
        });
    };

    const handleToggle = (id: string, currentStatus: boolean) => {
        // Optimistic update
        setSources(sources.map(s => s.id === id ? { ...s, isActive: !currentStatus } : s));

        startTransition(async () => {
            const result = await toggleLeadSource(id, !currentStatus);
            if (!result.success) {
                // Revert
                setSources(sources.map(s => s.id === id ? { ...s, isActive: currentStatus } : s));
                toast.error('Failed to update status');
            }
        });
    };

    const sortedSources = [...sources].sort((a, b) => a.name.localeCompare(b.name));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Lead Sources</CardTitle>
                <CardDescription>Manage the options available for "Lead Source" in contact forms.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        placeholder="Add new source (e.g. LinkedIn)"
                        value={newSource}
                        onChange={(e) => setNewSource(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                    />
                    <Button onClick={handleAdd} disabled={isPending || !newSource.trim()}>
                        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        <span className="ml-2 hidden sm:inline">Add</span>
                    </Button>
                </div>

                <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
                    {sortedSources.length === 0 ? (
                        <div className="p-4 text-center text-muted-foreground text-sm">No lead sources defined.</div>
                    ) : (
                        sortedSources.map((source) => (
                            <div key={source.id} className="flex items-center justify-between p-3">
                                <span className={source.isActive ? '' : 'text-muted-foreground line-through'}>{source.name}</span>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={source.isActive}
                                        onCheckedChange={() => handleToggle(source.id, source.isActive)}
                                    />
                                    {/* Delete could be added later if needed, mostly toggle is safer to preserve history */}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
