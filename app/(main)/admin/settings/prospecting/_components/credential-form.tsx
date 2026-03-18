'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createScrapingCredential, updateScrapingCredential } from '../actions';
import { BazarakiAuthButton } from './bazaraki-auth-button';

export function CredentialForm({ connectionId, locationId, initialData = null, platform }: { connectionId: string; locationId: string; initialData?: any; platform?: string }) {
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
                <label className="text-sm font-medium">
                    {platform === 'bazaraki' ? 'Phone Number (for WhatsApp Login)' : 'Login Username / Email'}
                </label>
                <Input name="authUsername" required defaultValue={initialData?.authUsername} placeholder={platform === 'bazaraki' ? "e.g. +35799123456" : "e.g. crawler1@estio.co"} />
            </div>

            {platform !== 'bazaraki' && (
                <div className="grid gap-2">
                    <label className="text-sm font-medium">Password</label>
                    <Input name="authPassword" type="password" required={!initialData?.id} placeholder={initialData?.id ? "•••••••• (Leave blank to keep)" : "Password"} />
                    <p className="text-xs text-muted-foreground">Passwords are securely encrypted at rest.</p>
                </div>
            )}
            
            {initialData?.id && (
                <div className="grid gap-2">
                    <label className="text-sm font-medium">Status Override</label>
                    <select name="status" defaultValue={initialData?.status || 'active'} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                        <option value="active">Active (Rotating)</option>
                        <option value="rate_limited">Rate Limited (Cooling down)</option>
                        <option value="banned">Banned (Do not use)</option>
                        <option value="locked">Locked</option>
                        <option value="needs_auth">Needs Authentication (Session Expired)</option>
                    </select>
                </div>
            )}

            {initialData?.id && platform === 'bazaraki' && (
                <div className="space-y-2">
                    {initialData?.status === 'needs_auth' && (
                        <div className="p-3 border border-red-200 bg-red-50 text-red-800 rounded-md text-sm">
                            ⚠️ <strong>Session Expired:</strong> You must generate a new WhatsApp QR code below and scan it to resume scraping.
                        </div>
                    )}
                    <BazarakiAuthButton credentialId={initialData.id} phone={initialData.authUsername} />
                </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Credential'}</Button>
            </div>
        </form>
    );
}
