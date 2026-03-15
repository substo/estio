'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createScrapingConnection, updateScrapingConnection } from '../actions';

export function ConnectionForm({ locationId, initialData = null }: { locationId: string; initialData?: any }) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    
    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        
        try {
            const formData = new FormData(e.currentTarget);
            const data = {
                name: formData.get('name'),
                platform: formData.get('platform'),
                enabled: formData.get('enabled') === 'on',
            };
            
            if (initialData?.id) {
                await updateScrapingConnection(initialData.id, locationId, data);
            } else {
                await createScrapingConnection(locationId, data);
            }
            
            router.push('/admin/settings/prospecting');
            router.refresh();
        } catch (error) {
            console.error(error);
            alert("Failed to save Connection. Check console.");
        } finally {
            setLoading(false);
        }
    }
    
    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl bg-card p-6 border rounded-lg">
            
            <div className="grid gap-2">
                <label className="text-sm font-medium">Connection Name</label>
                <Input name="name" required defaultValue={initialData?.name} placeholder="e.g. Primary Bazaraki Account" />
            </div>
            
            <div className="grid gap-2">
                <label className="text-sm font-medium">Platform</label>
                <select name="platform" defaultValue={initialData?.platform || 'bazaraki'} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                    <option value="bazaraki">Bazaraki</option>
                    <option value="facebook_marketplace">Facebook Marketplace</option>
                    <option value="instagram">Instagram</option>
                    <option value="spitogatos">Spitogatos</option>
                    <option value="custom">Custom Site</option>
                </select>
                <p className="text-xs text-muted-foreground">Select the base platform to inherit rate-limits and authentication handling patterns.</p>
            </div>

            <div className="flex items-center gap-2 mt-4 border-t pt-4">
                <input type="checkbox" id="enabled" name="enabled" defaultChecked={initialData ? initialData.enabled : true} className="w-4 h-4" />
                <label htmlFor="enabled" className="text-sm font-medium">Connection Active</label>
            </div>

            <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" type="button" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Connection'}</Button>
            </div>
        </form>
    );
}
