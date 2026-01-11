'use client';

import { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Pencil } from 'lucide-react';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { updateCompany } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { FeedManager } from './feed-manager';

function SubmitButton() {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save Changes'}
        </Button>
    );
}

type CompanyData = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    type: string | null;
    locationId: string;
    propertyRoles?: {
        id: string;
        role: string;
        property: { title: string };
    }[];
    contactRoles?: {
        id: string;
        role: string;
        contact: { name: string | null };
    }[];
    feeds?: {
        id: string;
        url: string;
        format: string;
        lastSyncAt: Date | null;
        isActive: boolean;
    }[];
};

function EditCompanyForm({ company, onSuccess }: { company: CompanyData; onSuccess: () => void }) {
    const [state, formAction] = useActionState(updateCompany, {
        message: '',
        errors: {},
        success: false,
    });
    const { toast } = useToast();
    const [type, setType] = useState(company.type || 'Management');

    useEffect(() => {
        if (state.success) {
            onSuccess();
            toast({
                title: 'Success',
                description: 'Company updated successfully.',
            });
        } else if (state.message && !state.success) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast, onSuccess]);

    return (
        <>
            <form action={formAction} className="flex flex-col flex-1 overflow-hidden">
                <input type="hidden" name="locationId" value={company.locationId} />
                <input type="hidden" name="companyId" value={company.id} />

                <div className="grid gap-4 py-4 flex-1 overflow-y-auto px-1">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Name</Label>
                        <div className="col-span-3">
                            <Input id="name" name="name" defaultValue={company.name} required />
                            {state.errors?.name && <p className="text-sm text-red-500 mt-1">{state.errors.name.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="type" className="text-right">Type</Label>
                        <div className="col-span-3">
                            <Select name="type" value={type} onValueChange={setType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Management">Management</SelectItem>
                                    <SelectItem value="Developer">Developer</SelectItem>
                                    <SelectItem value="Agency">Agency</SelectItem>
                                    <SelectItem value="Other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                            {state.errors?.type && <p className="text-sm text-red-500 mt-1">{state.errors.type.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">Email</Label>
                        <div className="col-span-3">
                            <Input id="email" name="email" type="email" defaultValue={company.email || ''} />
                            {state.errors?.email && <p className="text-sm text-red-500 mt-1">{state.errors.email.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">Phone</Label>
                        <div className="col-span-3">
                            <Input id="phone" name="phone" type="tel" defaultValue={company.phone || ''} />
                            {state.errors?.phone && <p className="text-sm text-red-500 mt-1">{state.errors.phone.join(', ')}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="website" className="text-right">Website</Label>
                        <div className="col-span-3">
                            <Input id="website" name="website" type="url" defaultValue={company.website || ''} placeholder="https://" />
                            {state.errors?.website && <p className="text-sm text-red-500 mt-1">{state.errors.website.join(', ')}</p>}
                        </div>
                    </div>

                    {/* Display Roles (Read-only for now in this iteration, matching plan) */}
                    {(company.propertyRoles?.length || 0) > 0 && (
                        <div className="border-t pt-4 mt-2">
                            <Label className="mb-2 block">Linked Properties</Label>
                            <div className="space-y-2">
                                {company.propertyRoles?.map((role) => (
                                    <div key={role.id} className="text-sm flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                        <span>
                                            <span className="font-medium">{role.role}</span> for {role.property.title}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {(company.contactRoles?.length || 0) > 0 && (
                        <div className="border-t pt-4 mt-2">
                            <Label className="mb-2 block">Linked Contacts</Label>
                            <div className="space-y-2">
                                {company.contactRoles?.map((role) => (
                                    <div key={role.id} className="text-sm flex justify-between items-center bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                        <span>
                                            <span className="font-medium">{role.role}</span> - {role.contact.name}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
                <DialogFooter className="pt-4">
                    <SubmitButton />
                </DialogFooter>
            </form >
            <FeedManager companyId={company.id} initialFeeds={company.feeds || []} />
        </>
    );
}

export function EditCompanyDialog({ company }: { company: CompanyData }) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Edit</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Edit Company</DialogTitle>
                    <DialogDescription>
                        Update company details.
                    </DialogDescription>
                </DialogHeader>
                <EditCompanyForm company={company} onSuccess={() => setOpen(false)} />
            </DialogContent>
        </Dialog>
    );
}
