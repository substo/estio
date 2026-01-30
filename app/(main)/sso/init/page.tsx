'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, ExternalLink, ShieldCheck, CheckCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';



function SSOInitContent() {
    const searchParams = useSearchParams();
    const userId = searchParams.get('userId');
    const locationId = searchParams.get('locationId');
    const userEmail = searchParams.get('userEmail');

    const [status, setStatus] = useState<'checking' | 'needs-popup' | 'redirecting' | 'success-waiting'>('checking');
    const [debugInfo, setDebugInfo] = useState<string[]>([]);

    useEffect(() => {
        const checkAccess = async () => {
            // Check if we are in an iframe
            const isIframe = window.location !== window.parent.location;
            setDebugInfo(prev => [...prev, `Context: ${isIframe ? 'Iframe' : 'Main Window'}`]);

            if (!userId || !locationId || !userEmail) {
                setDebugInfo(prev => [...prev, 'Error: Missing parameters']);
                return;
            }

            // SEAMLESS FIRST STRATEGY
            // 1. Try to redirect directly (modern browsers with CHIPS support will work)
            // 2. If we are back here or failed, check a flag and show popup

            // Note: sessionStorage is isolated to the iframe origin, so it persists across reloads in the iframe
            const hasAttempted = window.sessionStorage.getItem('ghl_sso_attempt_v2');

            if (isIframe && hasAttempted) {
                // We tried seamless and failed (or user reloaded). Show Popup/Manual flow.
                setDebugInfo(prev => [...prev, 'Seamless attempt failed or repeated. Triggering Popup Flow.']);
                setStatus('needs-popup');
            } else {
                // First try - go for seamless
                if (isIframe) {
                    window.sessionStorage.setItem('ghl_sso_attempt_v2', 'true');
                    setDebugInfo(prev => [...prev, 'Attempting seamless redirect...']);
                }
                proceedToAuth();
            }
        };

        checkAccess();
    }, [userId, locationId, userEmail]);

    const proceedToAuth = () => {
        setStatus('redirecting');
        // Redirect to the API logic which generates token and sends to validation
        window.location.href = `/api/sso/start?userId=${userId}&locationId=${locationId}&userEmail=${userEmail}`;
    };

    const handleConnect = () => {
        // Calculate screen center for popup
        const width = 500;
        const height = 600;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;

        // Use the Bridge Page instead of full Auth
        // This establishes top-level domain history for Storage Access API
        // without triggering a Clerk sign-in (saving rate limits)
        const popupUrl = `/sso/bridge`;

        const popup = window.open(
            popupUrl,
            'GHL_Bridge',
            `width=${width},height=${height},top=${top},left=${left},status=yes,scrollbars=yes`
        );

        if (!popup) {
            alert('Please allow popups for this site to connect.');
            return;
        }

        // Listen for success message from popup
        const handleMessage = (event: MessageEvent) => {
            // We listen for 'bridge-ready' from the bridge page
            // OR 'auth-success' fallback if we revert to full auth
            if (event.data === 'bridge-ready' || event.data === 'auth-success') {
                setDebugInfo(prev => [...prev, 'Bridge established. Waiting for storage access...']);
                setStatus('success-waiting');
                window.removeEventListener('message', handleMessage);
            }
        };

        window.addEventListener('message', handleMessage);
    };

    const handleContinue = async () => {
        setDebugInfo(prev => [...prev, 'Requesting Storage Access...']);

        try {
            // Check if function exists (some older browsers might not support it, though usually they don't block cookies either)
            if (document.requestStorageAccess) {
                await document.requestStorageAccess();
                setDebugInfo(prev => [...prev, 'Storage Access GRANTED']);
            } else {
                setDebugInfo(prev => [...prev, 'Storage Access API not available, proceeding...']);
            }
        } catch (err) {
            // If denied, we still try to proceed. 
            // Often if the user just interacted with the First-Party popup, the browser might have implicitly granted it,
            // or we might need to fallback to a full redirect (future improvement).
            console.error('Storage access denied:', err);
            setDebugInfo(prev => [...prev, 'Storage Access DENIED (or failed)']);
        }

        // Proceed to reload/redirect which should now see the cookies
        // CRITICAL UPDATE: invalidating the logic of just going to /admin. 
        // We must RESTART the SSO flow to ensure the cookie is SET inside this iframe context 
        // now that we (hopefully) have Storage Access. 
        // Relying on the popup's cookie is flaky across different browser partitions.
        window.location.href = `/api/sso/start?userId=${userId}&locationId=${locationId}&userEmail=${userEmail}`;
    };

    if (!userId || !locationId || !userEmail) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <h1 className="text-xl font-semibold text-red-600">Configuration Error</h1>
                <p className="text-gray-500 mt-2">Missing required parameters.</p>
                <div className="mt-4 p-2 bg-gray-100 rounded text-xs">
                    {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
                </div>
            </div>
        )
    }

    if (status === 'redirecting') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                <h1 className="text-xl font-semibold text-gray-900">Connecting...</h1>
            </div>
        );
    }

    if (status === 'success-waiting') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 font-sans">
                <div className="bg-white p-8 rounded-xl shadow-lg max-w-sm w-full text-center">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
                        <CheckCircle className="h-8 w-8 text-green-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Connection Verified</h1>
                    <p className="text-gray-600 mb-8 text-sm">
                        Your account has been securely connected. Click below to continue.
                    </p>

                    <Button
                        onClick={handleContinue}
                        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700"
                        size="lg"
                    >
                        Continue to Dashboard <ArrowRight className="h-4 w-4" />
                    </Button>

                    <div className="mt-4 p-2 bg-gray-50 rounded text-xs text-left text-gray-400 overflow-hidden">
                        <p className="font-semibold mb-1">Debug:</p>
                        {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'needs-popup') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 font-sans">
                <div className="bg-white p-8 rounded-xl shadow-lg max-w-sm w-full text-center">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-6">
                        <ShieldCheck className="h-8 w-8 text-blue-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-2">Connect Account</h1>
                    <p className="text-gray-600 mb-8 text-sm">
                        For security reasons, we need to open a secure window to verify your identity.
                    </p>

                    <Button
                        onClick={handleConnect}
                        className="w-full flex items-center justify-center gap-2"
                        size="lg"
                    >
                        Connect Securely <ExternalLink className="h-4 w-4" />
                    </Button>

                    <p className="text-xs text-gray-400 mt-4">
                        This will open a popup window. Please ensure popups are allowed.
                    </p>

                    <div className="mt-4 p-2 bg-gray-50 rounded text-xs text-left text-gray-400 overflow-hidden">
                        <p className="font-semibold mb-1">Debug:</p>
                        {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
            <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
            <h1 className="text-xl font-semibold text-gray-900">Initializing...</h1>
            <div className="mt-4 p-2 bg-gray-100 rounded text-xs text-center max-w-sm">
                {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
            </div>
        </div>
    );
}

export default function SSOInitPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
            </div>
        }>
            <SSOInitContent />
        </Suspense>
    );
}

