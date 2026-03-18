'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface BazarakiAuthButtonProps {
    credentialId: string;
    phone: string;
    onSuccess?: () => void;
}

export function BazarakiAuthButton({ credentialId, phone, onSuccess }: BazarakiAuthButtonProps) {
    const [loading, setLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [qrCodeData, setQrCodeData] = useState<string | null>(null);
    const [errorDetails, setErrorDetails] = useState<string | null>(null);
    const router = useRouter();

    const handleAuth = async () => {
        if (!phone) {
            alert('Phone number is required. Save the credential first.');
            return;
        }

        try {
            setLoading(true);
            setQrCodeData(null);
            setErrorDetails(null);
            setStatusMessage('Connecting to server...');

            const res = await fetch('/api/admin/bazaraki-auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credentialId, phone }),
            });

            if (!res.body) throw new Error('ReadableStream not supported by browser.');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            
            let done = false;
            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;
                if (value) {
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.replace('data: ', ''));
                                
                                if (data.message) setStatusMessage(data.message);
                                
                                if (data.status === 'qr_ready' && data.qrCode) {
                                    setQrCodeData(data.qrCode);
                                } else if (data.status === 'error') {
                                    const errMsg = data.error || 'Unknown error';
                                    const debugHtml = data.debugHtml || '';
                                    setErrorDetails(`${errMsg}\n\n--- Debug HTML ---\n${debugHtml}`);
                                    setLoading(false);
                                } else if (data.status === 'success') {
                                    toast.success('Successfully authenticated with Bazaraki! Session state saved.');
                                    if (onSuccess) {
                                        onSuccess();
                                    } else {
                                        setLoading(false);
                                        router.refresh();
                                    }
                                    return; // exit loop cleanly before unmount
                                }
                            } catch (e) {
                                console.error('Failed to parse stream chunk', line);
                            }
                        }
                    }
                }
            }
        } catch (e: any) {
            setErrorDetails(`Client error: ${e.message}`);
            setLoading(false);
        }
    };

    return (
        <div className="mt-4 p-4 border rounded-md bg-muted/30">
            <h3 className="font-semibold text-sm mb-2">Remote WhatsApp Authentication</h3>
            
            {!qrCodeData ? (
                <>
                    <p className="text-xs text-muted-foreground mb-4">
                        Click below to spin up a background headless browser. Bazaraki will generate a QR code that will stream here.
                    </p>
                    <Button 
                        onClick={handleAuth} 
                        disabled={loading || !phone}
                        variant="default"
                    >
                        {loading ? 'Connecting...' : 'Generate WhatsApp QR Code'}
                    </Button>
                </>
            ) : (
                <div className="flex flex-col items-center p-4 bg-white border rounded shadow-sm gap-4">
                    <p className="text-sm font-semibold text-black">Scan the QR Code with your Phone Camera</p>
                    <img src={qrCodeData} alt="Bazaraki Auth QR Code" className="w-64 h-64 border rounded" />
                    <p className="text-xs text-gray-600 text-center max-w-sm">
                        Tap the link that appears on your phone screen, then hit &quot;Send&quot; in WhatsApp. 
                        Do not close this page. Waiting for approval (up to 90s)...
                    </p>
                </div>
            )}
            
            {statusMessage && (
                <p className="text-xs text-muted-foreground mt-4 italic bg-muted p-2 rounded">
                    Status: {statusMessage}
                </p>
            )}

            {errorDetails && (
                <div className="mt-4 p-3 border border-red-300 bg-red-50 rounded text-xs">
                    <p className="font-semibold text-red-700 mb-2">Error Details (for debugging):</p>
                    <pre className="whitespace-pre-wrap break-all max-h-64 overflow-y-auto text-red-800 bg-red-100 p-2 rounded">
                        {errorDetails}
                    </pre>
                </div>
            )}
        </div>
    );
}
