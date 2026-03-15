'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { manualTriggerScrape } from '../actions';
import { toast } from 'sonner';
import { Play, Loader2 } from 'lucide-react';

export function RunScraperButton({ taskId, locationId }: { taskId: string; locationId: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handleRun = async (pageLimit?: number) => {
        setIsLoading(true);
        try {
            await manualTriggerScrape(taskId, locationId, pageLimit);
            toast.success(
                pageLimit 
                ? `Scraping task queued (${pageLimit} pages). Check back soon.`
                : 'Full scraping task queued. Check back soon.'
            );
            // Refresh the page so Run History panel shows the new "running" entry
            router.refresh();
        } catch (error: any) {
            toast.error(error.message || 'Failed to queue scraping task');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={isLoading} className="gap-2">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Run Now
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleRun(1)}>
                    Scrape 1 Page (Test Run)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRun(5)}>
                    Scrape 5 Pages
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleRun()}>
                    Run Full Configured Scrape
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
