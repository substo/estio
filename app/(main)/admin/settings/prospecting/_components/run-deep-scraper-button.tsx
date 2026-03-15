'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { manualTriggerDeepScrape } from '../actions';
import { toast } from 'sonner';
import { Zap, Loader2 } from 'lucide-react';

export function RunDeepScraperButton({ locationId }: { locationId: string }) {
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handleRun = async () => {
        setIsLoading(true);
        try {
            await manualTriggerDeepScrape(locationId, 50); // Defaulting to 50 for manual sweeps
            toast.success('Deep scraping task queued. Check back soon for updated AI classifications.');
            router.refresh(); // Or handle optimistically
        } catch (error: any) {
            toast.error(error.message || 'Failed to queue deep scraping task');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Button 
            variant="default" 
            size="sm" 
            onClick={handleRun} 
            disabled={isLoading} 
            className="gap-2 bg-indigo-600 hover:bg-indigo-700"
        >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-current" />}
            Run Deep Scrape
        </Button>
    );
}
