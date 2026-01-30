'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileText, Users, CheckCircle, ArrowRight, ArrowLeft, Loader2, X, UserCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { createImportSession, getContactsForMapping, saveContactMappings, executeImport } from './actions';
import { ContactSearchSelect, ContactOption } from './_components/contact-search-select';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type Step = 'upload' | 'mapping' | 'review' | 'complete';

interface PreviewMessage {
    date: Date;
    author: string | null;
    message: string;
}

export default function ImportPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>('upload');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Upload state
    const [fileName, setFileName] = useState<string>('');
    const [fileContent, setFileContent] = useState<string>('');

    // Session state
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [uniqueAuthors, setUniqueAuthors] = useState<string[]>([]);
    const [messageCount, setMessageCount] = useState(0);
    const [preview, setPreview] = useState<PreviewMessage[]>([]);

    // Mapping state
    const [contacts, setContacts] = useState<ContactOption[]>([]);
    const [mappings, setMappings] = useState<Record<string, string | null>>({});
    const [ownerAuthor, setOwnerAuthor] = useState<string | null>(null); // Which author is "me" (the business)

    // Import result
    const [importResult, setImportResult] = useState<{ importedCount: number; conversationsCreated: number } | null>(null);

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
            const result = await createImportSession(fileName, fileContent);

            if (!result.success) {
                setError(result.error || 'Failed to parse file');
                return;
            }

            setSessionId(result.sessionId!);
            setUniqueAuthors(result.uniqueAuthors || []);
            setMessageCount(result.messageCount || 0);
            setPreview(result.preview || []);

            // Initialize empty mappings
            const initialMappings: Record<string, string | null> = {};
            for (const author of result.uniqueAuthors || []) {
                initialMappings[author] = null;
            }
            setMappings(initialMappings);

            // Fetch contacts for mapping
            const contactList = await getContactsForMapping();
            setContacts(contactList);

            setStep('mapping');
        } catch (err: any) {
            setError(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const handleMapping = (author: string, contactId: string | null) => {
        setMappings(prev => ({
            ...prev,
            [author]: contactId
        }));
    };

    const handleSaveMappings = async () => {
        if (!sessionId) return;

        setLoading(true);
        try {
            const result = await saveContactMappings(sessionId, mappings, ownerAuthor);
            if (result.success) {
                setStep('review');
            } else {
                setError(result.error || 'Failed to save mappings');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleExecuteImport = async () => {
        if (!sessionId) return;

        setLoading(true);
        try {
            const result = await executeImport(sessionId);
            if (result.success) {
                setImportResult({
                    importedCount: result.importedCount!,
                    conversationsCreated: result.conversationsCreated!
                });
                setStep('complete');
            } else {
                setError(result.error || 'Import failed');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const mappedCount = Object.values(mappings).filter(v => v !== null).length;
    const canProceed = ownerAuthor !== null && mappedCount > 0;

    return (
        <div className="container max-w-4xl mx-auto py-8 px-4">
            {/* Progress Steps */}
            <div className="flex items-center justify-center mb-8 gap-2">
                {(['upload', 'mapping', 'review', 'complete'] as Step[]).map((s, i) => (
                    <div key={s} className="flex items-center">
                        <div className={`
                            w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                            ${step === s ? 'bg-blue-600 text-white' :
                                (['upload', 'mapping', 'review', 'complete'].indexOf(step) > i) ? 'bg-green-500 text-white' :
                                    'bg-gray-200 text-gray-500'}
                        `}>
                            {(['upload', 'mapping', 'review', 'complete'].indexOf(step) > i) ? <CheckCircle className="w-4 h-4" /> : i + 1}
                        </div>
                        {i < 3 && <div className={`w-12 h-0.5 ${(['upload', 'mapping', 'review', 'complete'].indexOf(step) > i) ? 'bg-green-500' : 'bg-gray-200'}`} />}
                    </div>
                ))}
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
                </div>
            )}

            {/* Step 1: Upload */}
            {step === 'upload' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Upload className="w-5 h-5" /> Upload WhatsApp Export
                        </CardTitle>
                        <CardDescription>
                            Upload a .txt file exported from WhatsApp. Go to the chat in WhatsApp, tap More → Export Chat → Without Media.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div
                            className={`
                                border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors
                                ${fileContent ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'}
                            `}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            onClick={() => document.getElementById('file-input')?.click()}
                        >
                            <input
                                id="file-input"
                                type="file"
                                accept=".txt"
                                className="hidden"
                                onChange={handleFileUpload}
                            />

                            {fileContent ? (
                                <div className="space-y-2">
                                    <FileText className="w-12 h-12 mx-auto text-green-500" />
                                    <p className="font-medium text-green-700">{fileName}</p>
                                    <p className="text-sm text-gray-500">Click or drag to replace</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Upload className="w-12 h-12 mx-auto text-gray-400" />
                                    <p className="font-medium">Drop your .txt file here</p>
                                    <p className="text-sm text-gray-500">or click to browse</p>
                                </div>
                            )}
                        </div>

                        <div className="mt-6 flex justify-end">
                            <Button onClick={handleParse} disabled={!fileContent || loading}>
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Parse & Continue
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 2: Mapping */}
            {step === 'mapping' && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="w-5 h-5" /> Map Contacts
                        </CardTitle>
                        <CardDescription>
                            Found {messageCount} messages from {uniqueAuthors.length} sender(s). Map each sender to a contact in your database.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {/* Preview */}
                        {preview.length > 0 && (
                            <div className="mb-6 p-4 bg-slate-50 rounded-lg">
                                <h4 className="text-sm font-medium text-gray-500 mb-2">Message Preview</h4>
                                <div className="space-y-2 max-h-40 overflow-y-auto text-sm">
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

                        {/* Instructions */}
                        <div className="mb-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                            <p><strong>Step 1:</strong> Click "This is me" on your name (the person who exported the chat)</p>
                            <p><strong>Step 2:</strong> Map other senders to contacts in your database</p>
                        </div>

                        {/* Mapping Table */}
                        <div className="space-y-3">
                            {uniqueAuthors.map(author => {
                                const isOwner = ownerAuthor === author;
                                const isMapped = mappings[author] !== null && mappings[author] !== undefined;

                                return (
                                    <div
                                        key={author}
                                        className={cn(
                                            "flex items-center gap-4 p-3 border rounded-lg transition-colors",
                                            isOwner && "bg-indigo-50 border-indigo-300"
                                        )}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">{author}</p>
                                        </div>

                                        {isOwner ? (
                                            <>
                                                <Badge className="bg-indigo-600 text-white shrink-0">
                                                    <UserCircle className="w-3 h-3 mr-1" /> This is me
                                                </Badge>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setOwnerAuthor(null)}
                                                    className="text-gray-500 text-xs"
                                                >
                                                    Change
                                                </Button>
                                            </>
                                        ) : ownerAuthor === null ? (
                                            <>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setOwnerAuthor(author)}
                                                    className="shrink-0"
                                                >
                                                    <UserCircle className="w-4 h-4 mr-1" /> This is me
                                                </Button>
                                                <span className="text-gray-400 text-sm">or</span>
                                                <div className="w-64">
                                                    <ContactSearchSelect
                                                        contacts={contacts}
                                                        value={mappings[author]}
                                                        onChange={(contactId) => handleMapping(author, contactId)}
                                                        placeholder="Map to contact..."
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                                                <div className="w-72">
                                                    <ContactSearchSelect
                                                        contacts={contacts}
                                                        value={mappings[author]}
                                                        onChange={(contactId) => handleMapping(author, contactId)}
                                                        placeholder="Search & select contact..."
                                                    />
                                                </div>
                                                {isMapped && (
                                                    <Badge variant="outline" className="bg-green-50 text-green-700 shrink-0">Mapped</Badge>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-6 flex justify-between">
                            <Button variant="outline" onClick={() => setStep('upload')}>
                                <ArrowLeft className="w-4 h-4 mr-2" /> Back
                            </Button>
                            <Button onClick={handleSaveMappings} disabled={!canProceed || loading}>
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                {!ownerAuthor ? "Select yourself first" : `Continue (${mappedCount} contact${mappedCount !== 1 ? 's' : ''} mapped)`}
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 3: Review */}
            {step === 'review' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Review & Import</CardTitle>
                        <CardDescription>
                            Ready to import {messageCount} messages into {mappedCount} conversation(s).
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4 mb-6">
                            <div className="p-4 bg-blue-50 rounded-lg">
                                <h4 className="font-medium text-blue-800 mb-2">Summary</h4>
                                <ul className="text-sm text-blue-700 space-y-1">
                                    <li>• <strong>{messageCount}</strong> messages will be imported</li>
                                    <li>• <strong>{mappedCount}</strong> sender(s) mapped to contacts</li>
                                    <li>• <strong>{uniqueAuthors.length - mappedCount}</strong> sender(s) will be skipped</li>
                                </ul>
                            </div>

                            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                                <h4 className="font-medium text-yellow-800 mb-1">Note</h4>
                                <p className="text-sm text-yellow-700">
                                    Imported messages will be marked as inbound WhatsApp messages. Duplicate messages will be skipped.
                                </p>
                            </div>
                        </div>

                        <div className="flex justify-between">
                            <Button variant="outline" onClick={() => setStep('mapping')}>
                                <ArrowLeft className="w-4 h-4 mr-2" /> Back
                            </Button>
                            <Button onClick={handleExecuteImport} disabled={loading}>
                                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Import Messages
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 4: Complete */}
            {step === 'complete' && importResult && (
                <Card>
                    <CardHeader className="text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <CardTitle className="text-green-700">Import Complete!</CardTitle>
                        <CardDescription>
                            Successfully imported {importResult.importedCount} messages into {importResult.conversationsCreated} new conversation(s).
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                        <Button onClick={() => router.push('/admin/conversations')}>
                            View Conversations
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
