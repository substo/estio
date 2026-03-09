import { useEffect, useRef, useState } from "react";

export type EmailFrameSelection = {
    text: string;
    rect: {
        top: number;
        left: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
};

interface EmailFrameProps {
    html: string;
    onSelectionChange?: (selection: EmailFrameSelection | null) => void;
}

export function EmailFrame({ html, onSelectionChange }: EmailFrameProps) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const onSelectionChangeRef = useRef<EmailFrameProps["onSelectionChange"]>(onSelectionChange);
    const [height, setHeight] = useState<number>(0);

    useEffect(() => {
        onSelectionChangeRef.current = onSelectionChange;
    }, [onSelectionChange]);

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
                    html {
                        width: 100%;
                        max-width: 100%;
                        overflow-x: hidden;
                    }
                    body {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        max-width: 100%;
                        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
                        font-size: 14px;
                        line-height: 1.5;
                        color: #1f2937; /* text-gray-800 */
                        overflow-x: hidden;
                        overflow-y: hidden; /* Hide scrollbar inside iframe */
                        overflow-wrap: anywhere;
                        word-break: break-word;
                    }
                    * {
                        box-sizing: border-box;
                        max-width: 100%;
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                    }
                    /* Ensure table layouts don't break out */
                    table {
                        width: 100% !important;
                        max-width: 100% !important;
                        table-layout: fixed;
                    }
                    td, th {
                        white-space: normal;
                        overflow-wrap: anywhere;
                        word-break: break-word;
                    }
                    pre, code {
                        white-space: pre-wrap;
                        overflow-wrap: anywhere;
                        word-break: break-word;
                    }
                    a {
                        overflow-wrap: anywhere;
                        word-break: break-word;
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

        const emitSelection = () => {
            const selectionCallback = onSelectionChangeRef.current;
            if (!selectionCallback) return;
            try {
                const doc = iframe.contentDocument;
                const win = iframe.contentWindow;
                if (!doc || !win) {
                    selectionCallback(null);
                    return;
                }

                const selection = win.getSelection();
                const rawText = selection?.toString() || "";
                const trimmedText = rawText.replace(/\u00a0/g, " ").trim();
                if (!trimmedText || !selection || selection.rangeCount === 0) {
                    selectionCallback(null);
                    return;
                }

                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();
                if (!rect || (rect.width === 0 && rect.height === 0)) {
                    selectionCallback(null);
                    return;
                }

                const iframeRect = iframe.getBoundingClientRect();
                selectionCallback({
                    text: rawText.trim(),
                    rect: {
                        top: iframeRect.top + rect.top,
                        left: iframeRect.left + rect.left,
                        right: iframeRect.left + rect.right,
                        bottom: iframeRect.top + rect.bottom,
                        width: rect.width,
                        height: rect.height,
                    }
                });
            } catch {
                selectionCallback(null);
            }
        };

        if (onSelectionChangeRef.current) {
            doc.addEventListener("selectionchange", emitSelection);
            doc.addEventListener("mouseup", emitSelection);
            doc.addEventListener("keyup", emitSelection);
        }

        return () => {
            clearInterval(resizeInterval);
            if (onSelectionChangeRef.current) {
                doc.removeEventListener("selectionchange", emitSelection);
                doc.removeEventListener("mouseup", emitSelection);
                doc.removeEventListener("keyup", emitSelection);
                onSelectionChangeRef.current?.(null);
            }
        };
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
