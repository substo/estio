'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers, List, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export default function ProspectingLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="flex flex-col h-[calc(100vh-65px)] bg-slate-50/50 dark:bg-slate-950/20">
            {/* Unified Header */}
            <div className="bg-background border-b px-4 py-2 shrink-0">
                <div className="flex justify-between items-center">
                    <div className="flex items-baseline gap-3">
                        <h1 className="text-lg font-bold tracking-tight">Prospecting Hub</h1>
                        <p className="text-xs text-muted-foreground hidden lg:block">
                            Discover new sellers, analyze listings, convert leads.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs px-2" asChild>
                        <Link href="/admin/settings/prospecting">
                            <Settings className="w-3.5 h-3.5 mr-1" />
                            Settings
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Content Area — full bleed for triage layout */}
            <div className="flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
