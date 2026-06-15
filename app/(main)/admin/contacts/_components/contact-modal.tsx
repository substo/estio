'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '@/components/ui/dialog';

import { EditContactForm } from './edit-contact-dialog';
import { useEffect, useState } from 'react';
import { getContactDetails } from '../actions';
import { Loader2 } from 'lucide-react';

interface ContactModalProps {
    contactId: string;
    mode: 'view' | 'edit';
}

export default function ContactModal({ contactId, mode }: ContactModalProps) {
    const router = useRouter();
    const [open, setOpen] = useState(true);
    const [data, setData] = useState<{
        contact: any,
        leadSources: string[],
        propertyMap?: Record<string, string>,
        userMap?: Record<string, string>,
        isOutlookConnected?: boolean,
        isGoogleConnected?: boolean,
        isGhlConnected?: boolean
    } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetch = async () => {
            setLoading(true);
            try {
                const res = await getContactDetails(contactId);
                if (res) {
                    setData(res);
                } else {
                    // Handle not found or error (maybe close modal?)
                    setOpen(false);
                }
            } catch (error) {
                console.error("Failed to load contact details", error);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [contactId]);

    const handleOpenChange = (val: boolean) => {
        setOpen(val);
        if (!val) {
            router.back();
        }
    };

    const handleMergeSuccess = (targetContactId: string) => {
        setData(null);
        setLoading(true);
        router.replace(`/admin/contacts/${encodeURIComponent(targetContactId)}/view`);
        router.refresh();
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className={`${mode === 'edit' ? 'sm:max-w-[700px]' : 'sm:max-w-[1000px]'} flex max-h-[calc(100dvh-1rem)] min-h-0 w-[calc(100vw-1rem)] flex-col overflow-hidden p-4 sm:max-h-[85vh] sm:p-6`}>
                <DialogHeader className={mode === 'view' ? 'hidden' : 'shrink-0 pr-8'}>
                    <DialogTitle>{mode === 'edit' ? 'Edit Contact' : 'Contact Details'}</DialogTitle>
                    {mode === 'edit' && <DialogDescription>Update contact information.</DialogDescription>}
                </DialogHeader>

                {loading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : data ? (
                    <div className="pt-4 flex-1 min-h-0 flex flex-col">
                        <EditContactForm
                            key={`${data.contact.id}:${data.contact.contactType || 'unknown'}:${mode}`}
                            contact={data.contact}
                            leadSources={data.leadSources}
                            onSuccess={() => {
                                handleOpenChange(false);
                                router.refresh();
                            }}
                            initialMode={mode}
                            isOutlookConnected={data.isOutlookConnected}
                            isGoogleConnected={data.isGoogleConnected}
                            isGhlConnected={data.isGhlConnected}
                            onMergeSuccess={handleMergeSuccess}
                        />
                    </div>
                ) : (
                    <div className="text-center py-8 text-muted-foreground">
                        Contact not found or failed to load.
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
