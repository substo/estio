'use client';

import { useEffect } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

export default function SSOBridgePage() {
    useEffect(() => {
        // Notify the opener that we have established top-level context
        const notifyAndClose = async () => {
            if (window.opener) {
                // Small delay to ensure the human sees something (psychological) and browser registers interaction
                await new Promise(resolve => setTimeout(resolve, 800));
                window.opener.postMessage('bridge-ready', '*');
                window.close();
            } else {
                // Fallback
                window.location.href = '/';
            }
        };

        notifyAndClose();
    }, []);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-white p-4 font-sans text-center">
            <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-6 animate-pulse">
                <ShieldCheck className="h-8 w-8 text-blue-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Securing Connection</h1>
            <p className="text-gray-500 text-sm max-w-xs mx-auto">
                Establishing a secure handshake with the application...
            </p>
        </div>
    );
}
