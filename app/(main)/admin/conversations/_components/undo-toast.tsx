'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Undo2 } from 'lucide-react';

interface UndoToastProps {
    message: string;
    onUndo: () => void;
    onDismiss: () => void;
    duration?: number;
}

export function UndoToast({ message, onUndo, onDismiss, duration = 5000 }: UndoToastProps) {
    const [visible, setVisible] = useState(true);
    const [progress, setProgress] = useState(100);

    useEffect(() => {
        if (!visible) return;

        const startTime = Date.now();
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
            setProgress(remaining);

            if (remaining <= 0) {
                setVisible(false);
                onDismiss();
            }
        }, 50);

        return () => clearInterval(interval);
    }, [visible, duration, onDismiss]);

    const handleUndo = () => {
        setVisible(false);
        onUndo();
    };

    const handleDismiss = () => {
        setVisible(false);
        onDismiss();
    };

    if (!visible) return null;

    return (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 animate-in slide-in-from-bottom-2">
            <div className="bg-gray-900 text-white px-5 py-4 rounded-lg shadow-2xl border border-gray-700 min-w-[360px] max-w-md">
                <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium flex-1">{message}</span>

                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleUndo}
                            className="text-white hover:bg-gray-800 h-8 px-3"
                        >
                            <Undo2 className="w-4 h-4 mr-1.5" />
                            Undo
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDismiss}
                            className="text-gray-400 hover:bg-gray-800 hover:text-white h-8 w-8 p-0"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-1 bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-blue-500 transition-all duration-50 ease-linear"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
