'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function PopupCallbackPage() {
    useEffect(() => {
        // Notify the opener that authentication is complete
        if (window.opener) {
            window.opener.postMessage('auth-success', '*');
            window.close();
        } else {
            // Fallback if not in a popup (e.g. user refreshed the popup manually)
            // Redirect to admin or show a message
            window.location.href = '/admin';
        }
    }, []);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
            <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Authentication Successful</h1>
            <p className="text-gray-500 mt-2">Closing window...</p>
        </div>
    );
}
