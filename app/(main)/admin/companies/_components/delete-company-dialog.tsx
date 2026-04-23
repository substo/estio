'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { Trash2 } from 'lucide-react';

import { deleteCompany, type DeleteCompanyState } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type DeleteCompanyDialogProps = {
    company: {
        id: string;
        name: string;
        locationId: string;
        propertyRoleCount?: number;
        contactRoleCount?: number;
        feedCount?: number;
    };
    triggerVariant?: 'icon' | 'button';
    onDeleted?: () => void;
    redirectTo?: string;
};

const initialState: DeleteCompanyState = {
    success: false,
    message: '',
    errors: {},
};

function DeleteButton({ disabled }: { disabled: boolean }) {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" variant="destructive" disabled={disabled || pending}>
            {pending ? 'Deleting...' : 'Delete company'}
        </Button>
    );
}

export function DeleteCompanyDialog({
    company,
    triggerVariant = 'icon',
    onDeleted,
    redirectTo,
}: DeleteCompanyDialogProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [confirmationName, setConfirmationName] = useState('');
    const [state, formAction] = useActionState(deleteCompany, initialState);

    const dependencySummary = useMemo(() => {
        return [
            { label: 'property links', count: company.propertyRoleCount ?? 0 },
            { label: 'contact links', count: company.contactRoleCount ?? 0 },
            { label: 'feeds', count: company.feedCount ?? 0 },
        ];
    }, [company.contactRoleCount, company.feedCount, company.propertyRoleCount]);

    const canDelete = confirmationName.trim() === company.name;

    useEffect(() => {
        if (!state.message) {
            return;
        }

        if (state.success) {
            setOpen(false);
            setConfirmationName('');
            toast({
                title: 'Company deleted',
                description: `${company.name} was permanently removed.`,
            });
            onDeleted?.();
            if (redirectTo) {
                router.push(redirectTo);
            } else {
                router.refresh();
            }
        } else {
            toast({
                title: 'Delete failed',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [company.name, onDeleted, redirectTo, router, state.message, state.success, toast]);

    return (
        <AlertDialog
            open={open}
            onOpenChange={(nextOpen) => {
                setOpen(nextOpen);
                if (!nextOpen) {
                    setConfirmationName('');
                }
            }}
        >
            <AlertDialogTrigger asChild>
                {triggerVariant === 'button' ? (
                    <Button variant="destructive" size="sm">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Company
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete {company.name}</span>
                    </Button>
                )}
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Delete company?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                        <span className="block">
                            This permanently deletes <span className="font-medium text-foreground">{company.name}</span>.
                            Related properties and contacts will stay in the system, but their links to this company will be removed.
                        </span>
                        <span className="block rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-foreground">
                            {dependencySummary.map((item) => (
                                <span key={item.label} className="block">
                                    {item.count} {item.label}
                                </span>
                            ))}
                        </span>
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <form action={formAction} className="space-y-4">
                    <input type="hidden" name="companyId" value={company.id} />
                    <input type="hidden" name="locationId" value={company.locationId} />

                    <div className="space-y-2">
                        <Label htmlFor={`delete-company-${company.id}`}>Type the company name to confirm</Label>
                        <Input
                            id={`delete-company-${company.id}`}
                            name="confirmationName"
                            value={confirmationName}
                            onChange={(event) => setConfirmationName(event.target.value)}
                            placeholder={company.name}
                            autoComplete="off"
                        />
                        {state.errors?.confirmationName ? (
                            <p className="text-sm text-destructive">{state.errors.confirmationName.join(', ')}</p>
                        ) : null}
                    </div>

                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button type="button" variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <DeleteButton disabled={!canDelete} />
                    </AlertDialogFooter>
                </form>
            </AlertDialogContent>
        </AlertDialog>
    );
}
