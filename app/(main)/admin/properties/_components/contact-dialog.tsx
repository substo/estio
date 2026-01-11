'use client';

import { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from "@/components/ui/textarea";
import { createContact, updateContact } from '../../contacts/actions';
import { useToast } from '@/components/ui/use-toast';

function SubmitButton({ isEditing }: { isEditing: boolean }) {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={pending}>
            {pending ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Contact' : 'Create Contact')}
        </Button>
    );
}

interface ContactDialogProps {
    locationId: string;
    roleName?: string;
    contact?: { id: string; name: string; email?: string | null; phone?: string | null; message?: string | null };
    onSuccess?: (contact: { id: string; name: string; email?: string | null; phone?: string | null; message?: string | null }) => void;
    trigger?: React.ReactNode;
}

export function ContactDialog({ locationId, roleName = 'Contact', contact, onSuccess, trigger }: ContactDialogProps) {
    const [open, setOpen] = useState(false);
    const isEditing = !!contact;

    const action = isEditing ? updateContact : createContact;

    // @ts-ignore
    const [state, formAction] = useActionState(action, {
        message: '',
        errors: {},
        success: false,
    });
    const { toast } = useToast();

    useEffect(() => {
        if (state.success && open) {
            // @ts-ignore
            if (state.contact) {
                setOpen(false);
                toast({
                    title: 'Success',
                    description: `${roleName} ${isEditing ? 'updated' : 'created'} successfully.`,
                });
                if (onSuccess) {
                    // @ts-ignore
                    onSuccess(state.contact);
                }
            }
        } else if (state.message && !state.success && open) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast, open, onSuccess, roleName, isEditing]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" size="icon" type="button">
                        <Plus className="h-4 w-4" />
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{isEditing ? `Edit ${roleName}` : `Add ${roleName}`}</DialogTitle>
                    <DialogDescription>
                        {isEditing ? `Update details for this ${roleName.toLowerCase()}.` : `Create a new contact record for this ${roleName.toLowerCase()}.`}
                    </DialogDescription>
                </DialogHeader>
                <form action={formAction} onSubmit={(e) => e.stopPropagation()} className="grid gap-4 py-4">
                    <input type="hidden" name="locationId" value={locationId} />
                    {isEditing && <input type="hidden" name="contactId" value={contact.id} />}

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <div className="col-span-3">
                            <Input id="name" name="name" required defaultValue={contact?.name} />
                            {state.errors?.name && <p className="text-sm text-red-500 mt-1">{state.errors.name.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">Email</Label>
                        <div className="col-span-3">
                            <Input id="email" name="email" type="email" defaultValue={contact?.email || ''} />
                            {state.errors?.email && <p className="text-sm text-red-500 mt-1">{state.errors.email.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">Phone</Label>
                        <div className="col-span-3">
                            <Input id="phone" name="phone" type="tel" defaultValue={contact?.phone || ''} />
                            {state.errors?.phone && <p className="text-sm text-red-500 mt-1">{state.errors.phone.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-start gap-4">
                        <Label htmlFor="message" className="text-right pt-2">Notes / Company</Label>
                        <div className="col-span-3">
                            <Textarea
                                id="message"
                                name="message"
                                defaultValue={contact?.message || ''}
                                className="min-h-[100px]"
                                placeholder="Add company details or general notes here..."
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <SubmitButton isEditing={isEditing} />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
