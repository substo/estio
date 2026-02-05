'use client';

import { useState, useEffect } from 'react';
import { Trash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { deleteContact } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { type ContactData } from './contact-form';

interface DeleteContactDialogProps {
    contact: ContactData;
    trigger?: React.ReactNode;
    onSuccess?: () => void;
    onDelete?: () => void;
    isGoogleConnected?: boolean;
    isGhlConnected?: boolean;
}

export function DeleteContactDialog({ contact, trigger, onSuccess, onDelete, isGoogleConnected = false, isGhlConnected = false }: DeleteContactDialogProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // Initial State (will be updated from localStorage on mount)
    const [deleteFromGhl, setDeleteFromGhl] = useState(false);
    const [deleteFromGoogle, setDeleteFromGoogle] = useState(false);

    useEffect(() => {
        if (open) {
            // Load preferences when dialog opens
            const prefGhl = localStorage.getItem('estio_delete_pref_ghl');
            const prefGoogle = localStorage.getItem('estio_delete_pref_google');

            // Default to FALSE if not set, or use user preference
            // Only enable if the contact actually HAS a link AND integration is active
            if (contact.ghlContactId && isGhlConnected) {
                setDeleteFromGhl(prefGhl === 'true');
            }
            if (contact.googleContactId && isGoogleConnected) {
                setDeleteFromGoogle(prefGoogle === 'true');
            }
        }
    }, [open, contact.ghlContactId, contact.googleContactId, isGhlConnected, isGoogleConnected]);

    const handleDelete = async () => {
        setIsDeleting(true);

        // Save preferences for next time (even if hidden, if we set it)
        // But only valid if connection exists
        if (contact.ghlContactId && isGhlConnected) {
            localStorage.setItem('estio_delete_pref_ghl', String(deleteFromGhl));
        }
        if (contact.googleContactId && isGoogleConnected) {
            localStorage.setItem('estio_delete_pref_google', String(deleteFromGoogle));
        }

        try {
            const result = await deleteContact(contact.id, {
                deleteFromGhl,
                deleteFromGoogle
            });

            if (result.success) {
                toast({ title: "Success", description: result.message });
                setOpen(false);
                if (onDelete) onDelete();
                else if (onSuccess) onSuccess();
            } else {
                toast({ title: "Error", description: result.message, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "An unexpected error occurred", variant: "destructive" });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="destructive">
                        <Trash className="mr-2 h-4 w-4" /> Delete Contact
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Delete Contact</DialogTitle>
                    <DialogDescription>
                        Are you sure you want to delete <strong>{contact.name || 'this contact'}</strong>? This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4 space-y-4">
                    {/* GHL Option */}
                    {contact.ghlContactId && isGhlConnected && (
                        <div className="flex items-start space-x-2">
                            <Checkbox
                                id="delete-ghl"
                                checked={deleteFromGhl}
                                onCheckedChange={(c) => setDeleteFromGhl(c === true)}
                            />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="delete-ghl" className="font-medium cursor-pointer">
                                    Also delete from GoHighLevel?
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Will verify permissions before deleting.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Google Option */}
                    {contact.googleContactId && isGoogleConnected && (
                        <div className="flex items-start space-x-2">
                            <Checkbox
                                id="delete-google"
                                checked={deleteFromGoogle}
                                onCheckedChange={(c) => setDeleteFromGoogle(c === true)}
                            />
                            <div className="grid gap-1.5 leading-none">
                                <Label htmlFor="delete-google" className="font-medium cursor-pointer">
                                    Also delete from Google Contacts?
                                </Label>
                                <p className="text-sm text-muted-foreground">
                                    Requires you to have Google Sync connected.
                                </p>
                            </div>
                        </div>
                    )}

                    {(!contact.ghlContactId && !contact.googleContactId) && (
                        <p className="text-sm text-gray-500 italic">
                            This contact is only stored locally. It will be permanently removed from the database.
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>Cancel</Button>
                    <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                        {isDeleting ? "Deleting..." : "Delete Permanently"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
