'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers, List, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export default function ProspectingLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    return (
        <div className="flex flex-col h-full bg-slate-50/50 dark:bg-slate-950/20">
            {/* Unified Header */}
            <div className="bg-background border-b px-6 py-4 pb-0 flex flex-col justify-end pt-8">
                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Prospecting Hub</h1>
                        <p className="text-sm text-muted-foreground mt-1 mb-8">
                            Discover new private sellers, analyze market listings, and convert leads into clients.
                        </p>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/admin/settings/prospecting">
                            <Settings className="w-4 h-4 mr-2" />
                            Settings
                        </Link>
                    </Button>
                </div>

            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto">
                <div className="container mx-auto p-6 max-w-7xl">
                    {children}
                </div>
            </div>
        </div>
    );
}
