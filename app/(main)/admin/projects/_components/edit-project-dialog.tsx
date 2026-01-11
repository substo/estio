'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
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
import { Pencil } from 'lucide-react';
import { upsertProjectAction } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import ProjectForm from './project-form';
import { Project } from '@prisma/client';

function SubmitButton() {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : 'Save Changes'}
        </Button>
    );
}

export function EditProjectDialog({ project }: { project: Project }) {
    const [open, setOpen] = useState(false);
    const [state, formAction] = useActionState(upsertProjectAction, {
        message: '',
        success: false,
    });
    const { toast } = useToast();

    useEffect(() => {
        if (state.success) {
            setOpen(false);
            toast({
                title: 'Success',
                description: 'Project updated successfully.',
            });
        } else if (state.message && !state.success) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Edit Project: {project.name}</DialogTitle>
                    <DialogDescription>
                        Update project details.
                    </DialogDescription>
                </DialogHeader>

                <form action={formAction} className="flex flex-col flex-1 overflow-hidden">
                    <input type="hidden" name="locationId" value={project.locationId} />
                    <input type="hidden" name="ghlProjectId" value={project.ghlProjectId || ""} />

                    <ProjectForm project={project} locationId={project.locationId} />

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <SubmitButton />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
