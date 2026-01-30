'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { ContactForm } from './contact-form';

export function AddContactDialog({ locationId, leadSources }: { locationId: string; leadSources: string[] }) {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Contact
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Add Contact</DialogTitle>
                    <DialogDescription>
                        Add a new person. Configure lead details and preferences.
                    </DialogDescription>
                </DialogHeader>
                <ContactForm
                    mode="create"
                    locationId={locationId}
                    onSuccess={() => setOpen(false)}
                    leadSources={leadSources}
                />
            </DialogContent>
        </Dialog>
    );
}
