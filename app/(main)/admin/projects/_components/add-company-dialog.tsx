'use client';

import { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
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
import { createCompany } from '../../contacts/actions';
import { useToast } from '@/components/ui/use-toast';

function SubmitButton() {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={pending}>
            {pending ? 'Creating...' : 'Create Company'}
        </Button>
    );
}

interface AddCompanyDialogProps {
    locationId: string;
    type?: string;
    onSuccess?: (company: { id: string; name: string }) => void;
}

export function AddCompanyDialog({ locationId, type = 'Management', onSuccess }: AddCompanyDialogProps) {
    const [open, setOpen] = useState(false);
    const [state, formAction] = useActionState(createCompany, {
        message: '',
        errors: {},
        success: false,
    });
    const { toast } = useToast();

    useEffect(() => {
        if (state.success && state.company && open) {
            setOpen(false);
            toast({
                title: 'Success',
                description: 'Company created successfully.',
            });
            if (onSuccess) {
                onSuccess(state.company);
            }
        } else if (state.message && !state.success && open) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast, open, onSuccess]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="icon" type="button" title={`Add ${type}`}>
                    <Plus className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add {type} Company</DialogTitle>
                    <DialogDescription>
                        Create a new company record.
                    </DialogDescription>
                </DialogHeader>
                <form action={formAction} className="grid gap-4 py-4">
                    <input type="hidden" name="locationId" value={locationId} />
                    <input type="hidden" name="type" value={type} />

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <div className="col-span-3">
                            <Input id="name" name="name" required />
                            {state.errors?.name && <p className="text-sm text-red-500 mt-1">{state.errors.name.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">Email</Label>
                        <div className="col-span-3">
                            <Input id="email" name="email" type="email" />
                            {state.errors?.email && <p className="text-sm text-red-500 mt-1">{state.errors.email.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">Phone</Label>
                        <div className="col-span-3">
                            <Input id="phone" name="phone" type="tel" />
                            {state.errors?.phone && <p className="text-sm text-red-500 mt-1">{state.errors.phone.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="website" className="text-right">Website</Label>
                        <div className="col-span-3">
                            <Input id="website" name="website" type="url" placeholder="https://" />
                            {state.errors?.website && <p className="text-sm text-red-500 mt-1">{state.errors.website.join(', ')}</p>}
                        </div>
                    </div>

                    <DialogFooter>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
