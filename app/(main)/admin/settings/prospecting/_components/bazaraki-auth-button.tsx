'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

interface BazarakiAuthButtonProps {
    credentialId: string;
    phone: string;
}

export function BazarakiAuthButton({ credentialId, phone }: BazarakiAuthButtonProps) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleAuth = async () => {
        if (!phone) {
            alert('Phone number is required. Save the credential first.');
            return;
        }

        try {
            setLoading(true);
            const res = await fetch('/api/admin/bazaraki-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentialId, phone }),
            });

            const data = await res.json();
            
            if (data.success) {
                alert('Successfully authenticated with Bazaraki! Session state saved.');
                router.refresh();
            } else {
                alert(`Failed: ${data.error}. Check server logs for the HTML dump.`);
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="mt-4 p-4 border rounded-md bg-muted/30">
            <h3 className="font-semibold text-sm mb-2">Remote Authentication</h3>
            <p className="text-xs text-muted-foreground mb-4">
                Clicking this will spin up a remote browser to attempt a WhatsApp login. You will have up to 2 minutes to tap "Send" on the WhatsApp message on your phone.
            </p>
            <Button 
                onClick={handleAuth} 
                disabled={loading || !phone}
                variant="default"
            >
                {loading ? 'Waiting for WhatsApp approval (up to 2 mins)...' : 'Authenticate via WhatsApp'}
            </Button>
        </div>
    );
}
