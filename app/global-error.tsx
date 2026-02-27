'use client';

import { useEffect } from 'react';

const ACTION_RELOAD_KEY = "__estio_server_action_auto_reload_at";
const ACTION_RELOAD_COOLDOWN_MS = 10 * 60 * 1000;

function isStaleServerActionError(message: string): boolean {
    const normalized = String(message || "").toLowerCase();
    if (!normalized) return false;

    return (
        normalized.includes("failed-to-find-server-action") ||
        normalized.includes("unrecognizedactionerror") ||
        (normalized.includes("server action") && normalized.includes("was not found on the server"))
    );
}

function canAutoReloadOnce(): boolean {
    try {
        const raw = sessionStorage.getItem(ACTION_RELOAD_KEY);
        const now = Date.now();
        const last = raw ? Number(raw) : 0;
        if (Number.isFinite(last) && now - last < ACTION_RELOAD_COOLDOWN_MS) {
            return false;
        }

        sessionStorage.setItem(ACTION_RELOAD_KEY, String(now));
        return true;
    } catch {
        return true;
    }
}

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an external service or console
        console.error('GLOBAL APPLICATION ERROR:', error);

        // If this is a stale Server Action mismatch after a deploy, force one hard reload.
        if (isStaleServerActionError(error?.message || "") && canAutoReloadOnce()) {
            window.location.reload();
        }
    }, [error]);

    return (
        <html>
            <body>
                <div style={{ padding: '40px', fontFamily: 'system-ui' }}>
                    <h1>Something went wrong!</h1>
                    <p>The application crashed. Check the browser console or server logs for "GLOBAL APPLICATION ERROR".</p>
                    <pre style={{ background: '#f0f0f0', padding: '20px', borderRadius: '8px', overflow: 'auto' }}>
                        {error.message}
                        {error.stack}
                    </pre>
                    <button
                        onClick={() => reset()}
                        style={{
                            padding: '10px 20px',
                            marginTop: '20px',
                            background: 'black',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Try again
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '10px 20px',
                            marginTop: '10px',
                            marginLeft: '10px',
                            background: '#374151',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Hard refresh
                    </button>
                </div>
            </body>
        </html>
    );
}
