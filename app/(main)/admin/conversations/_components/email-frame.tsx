import { useEffect, useRef, useState } from "react";

interface EmailFrameProps {
    html: string;
}

export function EmailFrame({ html }: EmailFrameProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState<number>(0);

    const updateHeight = () => {
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow && iframe.contentDocument) {
            const body = iframe.contentDocument.body;
            if (body) {
                // Use scrollHeight to get the full height of the content
                setHeight(body.scrollHeight + 20); // Add a small buffer
            }
        }
    };

    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const doc = iframe.contentDocument;
        if (!doc) return;

        // Write content to iframe
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <base target="_blank">
                <style>
                    body {
                        margin: 0;
                        padding: 0;
                        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
                        font-size: 14px;
                        line-height: 1.5;
                        color: #1f2937; /* text-gray-800 */
                        overflow-y: hidden; /* Hide scrollbar inside iframe */
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                    }
                    /* Ensure table layouts don't break out */
                    table {
                        max-width: 100%;
                    }
                </style>
            </head>
            <body>
                ${html}
            </body>
            </html>
        `);
        doc.close();

        // Initial height calculation
        updateHeight();

        // Add load listener for images etc.
        iframe.onload = updateHeight;

        // Resize observer to detect content changes inside iframe if possible
        // Note: internal resize observer is tricky across iframe boundary, relying on load and initial render for now.
        // A simple interval check could be added if dynamic content is expected, but emails are usually static.
        const resizeInterval = setInterval(updateHeight, 500);

        return () => clearInterval(resizeInterval);
    }, [html]);

    return (
        <iframe
            ref={iframeRef}
            title="Email Content"
            className="w-full border-0"
            style={{ height: `${height}px`, minHeight: '100px' }}
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
    );
}
