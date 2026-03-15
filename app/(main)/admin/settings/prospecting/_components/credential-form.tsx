'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createScrapingCredential, updateScrapingCredential } from '../actions';

export function CredentialForm({ connectionId, locationId, initialData = null }: { connectionId: string; locationId: string; initialData?: any }) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    
    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setLoading(true);
        
        try {
            const formData = new FormData(e.currentTarget);
            const data = {
                authUsername: formData.get('authUsername') || null,
                authPassword: formData.get('authPassword') || null,
                status: formData.get('status') || 'active',
            };
            
            if (initialData?.id) {
                await updateScrapingCredential(initialData.id, locationId, data);
            } else {
                await createScrapingCredential(connectionId, locationId, data);
            }
            
            router.push(`/admin/settings/prospecting/connections/${connectionId}`);
            router.refresh();
        } catch (error) {
            console.error(error);
            alert("Failed to save Credential. Check console.");
        } finally {
            setLoading(false);
        }
    }
    
    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-w-xl bg-card p-6 border rounded-lg">
            
            <div className="grid gap-2">
                <label className="text-sm font-medium">Login Username / Email</label>
                <Input name="authUsername" required defaultValue={initialData?.authUsername} placeholder="e.g. crawler1@estio.co" />
            </div>

            <div className="grid gap-2">
                <label className="text-sm font-medium">Password</label>
                <Input name="authPassword" type="password" required={!initialData?.id} placeholder={initialData?.id ? "•••••••• (Leave blank to keep)" : "Password"} />
                <p className="text-xs text-muted-foreground">Passwords are securely encrypted at rest.</p>
            </div>
            
            {initialData?.id && (
                <div className="grid gap-2">
                    <label className="text-sm font-medium">Status Override</label>
                    <select name="status" defaultValue={initialData?.status || 'active'} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="active">Active (Rotating)</option>
                        <option value="rate_limited">Rate Limited (Cooling down)</option>
                        <option value="banned">Banned (Do not use)</option>
                        <option value="locked">Locked</option>
                    </select>
                </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Credential'}</Button>
            </div>
        </form>
    );
}
