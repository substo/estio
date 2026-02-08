'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, Loader2, X, UserCircle, CheckCircle } from 'lucide-react';
import { parseWhatsAppFile, executeDirectImport } from '../import/actions';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface PreviewMessage {
    date: Date;
    author: string | null;
    message: string;
}

interface WhatsAppImportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversationId: string;
    contactName: string;
    onImportComplete: () => void;
}

export function WhatsAppImportModal({
    open,
    onOpenChange,
    conversationId,
    contactName,
    onImportComplete
}: WhatsAppImportModalProps) {
    const [step, setStep] = useState<'upload' | 'confirm' | 'complete'>('upload');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // File state
    const [fileName, setFileName] = useState<string>('');
    const [fileContent, setFileContent] = useState<string>('');

    // Parse result
    const [messageCount, setMessageCount] = useState(0);
    const [uniqueAuthors, setUniqueAuthors] = useState<string[]>([]);
    const [preview, setPreview] = useState<PreviewMessage[]>([]);
    const [ownerAuthor, setOwnerAuthor] = useState<string | null>(null);

    // Import result
    const [importResult, setImportResult] = useState<{ importedCount: number; skippedCount: number } | null>(null);

    const resetState = () => {
        setStep('upload');
        setLoading(false);
        setError(null);
        setFileName('');
        setFileContent('');
        setMessageCount(0);
        setUniqueAuthors([]);
        setPreview([]);
        setOwnerAuthor(null);
        setImportResult(null);
    };

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) {
            resetState();
        }
        onOpenChange(newOpen);
    };

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.txt')) {
            setError('Please upload a .txt file exported from WhatsApp');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setFileName(file.name);
            setFileContent(content);
            setError(null);
        };
        reader.onerror = () => {
            setError('Failed to read file');
        };
        reader.readAsText(file);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.txt')) {
            setError('Please upload a .txt file exported from WhatsApp');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            setFileName(file.name);
            setFileContent(content);
            setError(null);
        };
        reader.readAsText(file);
    }, []);

    const handleParse = async () => {
        if (!fileContent) return;

        setLoading(true);
        setError(null);

        try {
            const result = await parseWhatsAppFile(fileContent);

            if (!result.success) {
                setError(result.error || 'Failed to parse file');
                return;
            }

            setMessageCount(result.messageCount || 0);
            setUniqueAuthors(result.uniqueAuthors || []);
            setPreview(result.preview || []);
            setStep('confirm');
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleImport = async () => {
        if (!ownerAuthor) {
            setError('Please select which author is you');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const result = await executeDirectImport(conversationId, fileContent, ownerAuthor);

            if (!result.success) {
                setError(result.error || 'Import failed');
                return;
            }

            setImportResult({
                importedCount: result.importedCount!,
                skippedCount: result.skippedCount!
            });
            setStep('complete');
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleComplete = () => {
        onImportComplete();
        handleOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Upload className="w-5 h-5" />
                        {step === 'complete' ? 'Import Complete' : 'Import WhatsApp Chat'}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'upload' && `Import messages into conversation with ${contactName}`}
                        {step === 'confirm' && `Found ${messageCount} messages from ${uniqueAuthors.length} sender(s)`}
                        {step === 'complete' && 'Your messages have been imported'}
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between text-sm">
                        <span>{error}</span>
                        <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
                    </div>
                )}

                {/* Step 1: Upload */}
                {step === 'upload' && (
                    <div className="space-y-4">
                        <div
                            className={cn(
                                "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
                                fileContent ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                            )}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            onClick={() => document.getElementById('modal-file-input')?.click()}
                        >
                            <input
                                id="modal-file-input"
                                type="file"
                                accept=".txt"
                                className="hidden"
                                onChange={handleFileUpload}
                            />

                            {fileContent ? (
                                <div className="space-y-2">
                                    <FileText className="w-10 h-10 mx-auto text-green-500" />
                                    <p className="font-medium text-green-700">{fileName}</p>
                                    <p className="text-xs text-gray-500">Click or drag to replace</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Upload className="w-10 h-10 mx-auto text-gray-400" />
                                    <p className="font-medium">Drop your .txt file here</p>
                                    <p className="text-xs text-gray-500">or click to browse</p>
                                </div>
                            )}
                        </div>

                        <p className="text-xs text-gray-500">
                            Export from WhatsApp: Open chat → More → Export Chat → Without Media
                        </p>

                        <div className="flex justify-end">
                            <Button onClick={handleParse} disabled={!fileContent || loading}>
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Parse File
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 2: Confirm */}
                {step === 'confirm' && (
                    <div className="space-y-4">
                        {/* Preview */}
                        {preview.length > 0 && (
                            <div className="p-3 bg-slate-50 rounded-lg">
                                <h4 className="text-xs font-medium text-gray-500 mb-2">Preview</h4>
                                <div className="space-y-1 max-h-24 overflow-y-auto text-xs">
                                    {preview.map((msg, i) => (
                                        <div key={i} className="flex gap-2">
                                            <span className="text-gray-400 shrink-0">{format(new Date(msg.date), 'PP')}</span>
                                            <span className="font-medium text-blue-600 shrink-0">{msg.author}:</span>
                                            <span className="text-gray-600 truncate">{msg.message}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Author Selection */}
                        <div>
                            <h4 className="text-sm font-medium mb-2">Who are you in this chat?</h4>
                            <div className="space-y-2">
                                {uniqueAuthors.map(author => {
                                    const isOwner = ownerAuthor === author;
                                    return (
                                        <button
                                            key={author}
                                            onClick={() => setOwnerAuthor(author)}
                                            className={cn(
                                                "w-full flex items-center justify-between p-3 border rounded-lg transition-colors text-left",
                                                isOwner ? "bg-indigo-50 border-indigo-300" : "hover:bg-gray-50"
                                            )}
                                        >
                                            <span className="font-medium truncate">{author}</span>
                                            {isOwner && (
                                                <Badge className="bg-indigo-600 text-white shrink-0">
                                                    <UserCircle className="w-3 h-3 mr-1" /> This is me
                                                </Badge>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex justify-between">
                            <Button variant="outline" onClick={() => setStep('upload')}>
                                Back
                            </Button>
                            <Button onClick={handleImport} disabled={!ownerAuthor || loading}>
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Import {messageCount} Messages
                            </Button>
                        </div>
                    </div>
                )}

                {/* Step 3: Complete */}
                {step === 'complete' && importResult && (
                    <div className="space-y-4 text-center py-4">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <div>
                            <p className="font-medium text-green-700">
                                {importResult.importedCount} messages imported
                            </p>
                            {importResult.skippedCount > 0 && (
                                <p className="text-sm text-gray-500">
                                    {importResult.skippedCount} duplicates skipped
                                </p>
                            )}
                        </div>
                        <Button onClick={handleComplete} className="w-full">
                            View Conversation
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
