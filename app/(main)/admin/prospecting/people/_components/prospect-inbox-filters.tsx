'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition, useState, useEffect } from 'react';
import { LEAD_SOURCE_CATEGORIES } from '@/app/(main)/admin/contacts/_components/contact-types';
import { Search } from 'lucide-react';
import { useDebounce } from 'use-debounce';

export function ProspectInboxFilters() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();

    const currentScope = searchParams.get('scope') || 'new';
    const currentSource = searchParams.get('source') || 'all';
    const currentQ = searchParams.get('q') || '';

    const [localQ, setLocalQ] = useState(currentQ);
    const [debouncedQ] = useDebounce(localQ, 400);

    const updateFilters = (key: string, value: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (value && value !== 'all') {
            params.set(key, value);
        } else {
            params.delete(key);
        }
        params.delete('skip'); // Reset pagination
        startTransition(() => {
            router.push(`?${params.toString()}`);
        });
    };

    useEffect(() => {
        if (debouncedQ !== currentQ) {
            updateFilters('q', debouncedQ);
        }
    }, [debouncedQ]);

    return (
        <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 border rounded-xl shadow-sm">
            {/* Scope Toggle */}
            <div className="flex rounded-md shadow-sm">
                <button
                    onClick={() => updateFilters('scope', 'new')}
                    className={`px-4 py-2 text-sm font-medium rounded-l-md border ${
                        currentScope === 'new'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted border-input'
                    }`}
                >
                    Needs Action
                </button>
                <button
                    onClick={() => updateFilters('scope', 'all')}
                    className={`px-4 py-2 text-sm font-medium rounded-r-md border-y border-r ${
                        currentScope === 'all'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background hover:bg-muted border-input'
                    }`}
                >
                    All Prospects
                </button>
            </div>

            <div className="h-8 w-px bg-border hidden sm:block mx-2" />

            {/* Keyword Search */}
            <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search name, phone, email..."
                    className="pl-9 bg-background"
                    value={localQ}
                    onChange={(e) => setLocalQ(e.target.value)}
                />
            </div>

            {/* Source Filter */}
            <div className="w-[180px]">
                <Select value={currentSource} onValueChange={(val) => updateFilters('source', val)}>
                    <SelectTrigger className="bg-background">
                        <SelectValue placeholder="All Sources" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Sources</SelectItem>
                        {Object.entries(LEAD_SOURCE_CATEGORIES).map(([key, config]) => (
                            <SelectItem key={key} value={key}>
                                <div className="flex items-center gap-2">
                                    <span className="text-base leading-none">{config.icon}</span>
                                    <span>{config.label}</span>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            
            {isPending && <span className="text-xs text-muted-foreground animate-pulse">Updating...</span>}
        </div>
    );
}
