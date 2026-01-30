'use client';

import { useEffect } from 'react';

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
                </div>
            </body>
        </html>
    );
}
