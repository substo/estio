'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createScrapingTask, updateScrapingTask } from '../actions';

export function TaskForm({ locationId, connections, initialData = null }: { locationId: string; connections: any[]; initialData?: any }) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    
    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        
        try {
            const formData = new FormData(e.currentTarget);
            const data = {
                name: formData.get('name'),
                connectionId: formData.get('connectionId'),
                targetUrls: formData.get('targetUrls'),
                scrapeFrequency: formData.get('scrapeFrequency'),
                extractionMode: formData.get('extractionMode'),
                enabled: formData.get('enabled') === 'on',
            };
            
            if (initialData?.id) {
                await updateScrapingTask(initialData.id, locationId, data);
            } else {
                await createScrapingTask(locationId, data);
            }
            
            router.push('/admin/settings/prospecting');
            router.refresh();
        } catch (error) {
            console.error(error);
            alert("Failed to save Task. Check console.");
        } finally {
            setLoading(false);
        }
    }
    
    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl bg-card p-6 border rounded-lg">
            
            <div className="grid gap-2">
                <label className="text-sm font-medium">Task Name</label>
                <Input name="name" required defaultValue={initialData?.name} placeholder="e.g. Bazaraki Paphos Rent" />
            </div>
            
            <div className="grid gap-2">
                <label className="text-sm font-medium">Required Connection (Auth/Limits)</label>
                <select name="connectionId" required defaultValue={initialData?.connectionId} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="" disabled>Select a platform connection...</option>
                    {connections.map(conn => (
                         <option key={conn.id} value={conn.id}>{conn.name} ({conn.platform})</option>
                    ))}
                </select>
            </div>

            <div className="grid gap-2">
                <label className="text-sm font-medium">Target URLs (Comma separated)</label>
                <Input name="targetUrls" required defaultValue={initialData?.targetUrls?.join(', ')} placeholder="https://www.bazaraki.com/real-estate/..." />
                <p className="text-xs text-muted-foreground">The bot will iterate over these URLs sequentially using the selected Connection's session limits.</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <label className="text-sm font-medium">Scrape Frequency</label>
                    <select name="scrapeFrequency" defaultValue={initialData?.scrapeFrequency || 'daily'} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="hourly">Hourly</option>
                        <option value="every_6h">Every 6 Hours</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                    </select>
                </div>
                
                <div className="grid gap-2">
                    <label className="text-sm font-medium">Extraction Mode</label>
                    <select name="extractionMode" defaultValue={initialData?.extractionMode || 'hybrid'} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="css_selectors">Strict CSS Selectors</option>
                        <option value="ai_extraction">AI Extraction</option>
                        <option value="hybrid">Hybrid (CSS + AI Fallback)</option>
                    </select>
                </div>
            </div>

            <div className="flex items-center gap-2 mt-4 border-t pt-4">
                <input type="checkbox" id="enabled" name="enabled" defaultChecked={initialData ? initialData.enabled : true} className="w-4 h-4" />
                <label htmlFor="enabled" className="text-sm font-medium">Task Active</label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" type="button" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Task'}</Button>
            </div>
        </form>
    );
}
