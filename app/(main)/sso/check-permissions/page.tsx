'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

function CheckPermissionsContent() {
    const searchParams = useSearchParams();
    const locationId = searchParams.get('locationId');

    const [status, setStatus] = useState<'checking' | 'authorized' | 'denied'>('checking');
    const [debugInfo, setDebugInfo] = useState<string[]>([]);

    useEffect(() => {
        // Prevent running if we are already done or checking is complete
        if (status !== 'checking') return;

        if (!locationId) {
            setStatus('denied');
            setDebugInfo(prev => [...prev, 'Error: Missing locationId in URL']);
            return;
        }

        const isIframe = window.location !== window.parent.location;
        if (!isIframe) {
            setDebugInfo(prev => [...prev, 'Warning: Not running in an iframe']);
        } else {
            setDebugInfo(prev => [...prev, 'Status: Running in iframe']);
        }

        // Timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            if (status === 'checking') {
                console.warn('GHL postMessage timeout');
                setStatus('denied');
                setDebugInfo(prev => [...prev, 'Error: Timeout waiting for GHL context']);
            }
        }, 10000); // Increased to 10s

        const handleMessage = (event: MessageEvent) => {
            console.log('Received message:', event.data);
            setDebugInfo(prev => [...prev, `Msg: ${JSON.stringify(event.data).slice(0, 100)}`]);

            const data = event.data;

            // Check for user data response
            // We accept any object that has role/type OR is a known GHL response wrapper
            if (data) {
                // Direct object (as per some docs)
                if (data.type === 'agency' || data.type === 'account' || data.role) {
                    processUserData(data);
                    return;
                }

                // Wrapped object (common pattern)
                if (data.data && (data.data.type === 'agency' || data.data.type === 'account' || data.data.role)) {
                    processUserData(data.data);
                    return;
                }

                // Another wrapper pattern
                if (data.message === 'USER_DATA' && data.payload) {
                    processUserData(data.payload);
                    return;
                }
            }
        };

        const processUserData = (data: any) => {
            const userRole = data.role?.toLowerCase();
            const userType = data.type?.toLowerCase();

            setDebugInfo(prev => [...prev, `Found User: Role=${userRole}, Type=${userType}`]);

            const isAgencyUser = userType === 'agency';
            const isAdmin = userRole === 'admin';

            if (isAgencyUser || isAdmin) {
                setStatus('authorized');
                const oauthUrl = `/api/oauth/start?locationId=${locationId}`;
                window.location.href = oauthUrl;
            } else {
                setStatus('denied');
            }
            clearTimeout(timeoutId);
        };

        window.addEventListener('message', handleMessage);

        // Request user data from GHL parent
        // Try multiple known message formats
        setDebugInfo(prev => [...prev, 'Sending REQUEST_USER_DATA...']);
        window.parent.postMessage({ message: "REQUEST_USER_DATA" }, "*");
        window.parent.postMessage("REQUEST_USER_DATA", "*");

        return () => {
            window.removeEventListener('message', handleMessage);
            clearTimeout(timeoutId);
        };
    }, [locationId, status]);

    if (status === 'checking') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                <h1 className="text-xl font-semibold text-gray-900">Verifying Permissions...</h1>
                <p className="text-gray-500 mt-2">Checking if you are authorized to install this app.</p>
                <div className="mt-8 p-4 bg-gray-100 rounded text-xs font-mono text-gray-600 max-w-md w-full overflow-auto max-h-40">
                    {debugInfo.map((line, i) => <div key={i}>{line}</div>)}
                </div>
            </div>
        );
    }

    if (status === 'authorized') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="h-12 w-12 text-green-600 animate-spin mb-4" />
                <h1 className="text-xl font-semibold text-gray-900">Authorized!</h1>
                <p className="text-gray-500 mt-2">Redirecting to installation...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
            <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full text-center">
                <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100 mb-6">
                    <ShieldAlert className="h-8 w-8 text-red-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h1>
                <p className="text-gray-600 mb-6">
                    This application has not been installed for this location yet.
                    Only <strong>Admins</strong> can perform the initial setup.
                </p>

                <div className="bg-gray-100 p-4 rounded-lg text-left text-sm font-mono text-gray-700 mb-6 overflow-auto max-h-60">
                    <p className="font-bold text-xs text-gray-500 uppercase mb-1">Debug Info:</p>
                    {debugInfo.map((line, i) => <div key={i} className="border-b border-gray-200 last:border-0 py-1">{line}</div>)}
                </div>

                <div className="flex flex-col gap-2 w-full">
                    <Button
                        variant="outline"
                        onClick={() => window.location.reload()}
                        className="w-full"
                    >
                        Retry Verification
                    </Button>

                    <div className="relative my-2">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-gray-500">Or</span>
                        </div>
                    </div>

                    <Button
                        variant="default"
                        onClick={() => window.location.href = `/api/oauth/start?locationId=${locationId}`}
                        className="w-full"
                    >
                        I am an Admin (Continue Setup)
                    </Button>
                    <p className="text-xs text-gray-500 mt-2">
                        Warning: If you are not an admin, the setup will fail at the next step.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function CheckPermissionsPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mb-4" />
                <h1 className="text-xl font-semibold text-gray-900">Loading...</h1>
            </div>
        }>
            <CheckPermissionsContent />
        </Suspense>
    );
}
