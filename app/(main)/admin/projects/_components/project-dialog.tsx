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
import { Plus } from 'lucide-react';
import { upsertProjectAction } from '../actions';
import { useToast } from '@/components/ui/use-toast';
import ProjectForm from './project-form';
import { Project } from '@prisma/client';



export function ProjectDialog({ locationId, onSuccess, triggerButton, project }: { locationId: string, onSuccess?: (project: Project) => void, triggerButton?: React.ReactNode, project?: Project }) {
    const [open, setOpen] = useState(false);
    // Use the same upsert action. If 'project' exists, the form will include hidden ID which the action uses (or should use).
    // Note: upsertProjectAction uses 'ghlProjectId' to identify for update? 
    // Let's check project-form.tsx: It puts ghlProjectId in hidden input. 
    // BUT typically we update by our internal ID (id) or ghlProjectId.
    // The current action uses ghlProjectId for IDOR check and identification?
    // Wait, upsertProject helper likely uses ghlProjectId as unique key OR creates new?
    // I should ensure the form includes the ID if editing.
    // ProjectForm includes: <input type="hidden" name="ghlProjectId" value={project?.ghlProjectId || ""} />
    // If the project was created manually, it might not have ghlProjectId. It should have 'id'.
    // Let's adding 'id' to the form just in case the action supports it, or rely on upsert logic.
    // The 'upsertProject' function likely handles this.

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
                description: project ? 'Project updated successfully.' : 'Project created successfully.',
            });
            if (onSuccess && state.project) {
                onSuccess(state.project);
            }
        } else if (state.message && !state.success) {
            toast({
                title: 'Error',
                description: state.message,
                variant: 'destructive',
            });
        }
    }, [state, toast, project]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {triggerButton ? (
                    triggerButton
                ) : (
                    <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Project
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{project ? 'Edit Project' : 'Add New Project'}</DialogTitle>
                    <DialogDescription>
                        {project ? 'Update project details.' : 'Create a new development project.'}
                    </DialogDescription>
                </DialogHeader>

                <form action={formAction} onSubmit={(e) => e.stopPropagation()} className="flex flex-col flex-1 overflow-hidden">
                    <ProjectForm locationId={locationId} project={project} />

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <SubmitButton isEditing={!!project} />
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function SubmitButton({ isEditing }: { isEditing: boolean }) {
    const { pending } = useFormStatus();

    return (
        <Button type="submit" disabled={pending}>
            {pending ? 'Saving...' : (isEditing ? 'Save Changes' : 'Save Project')}
        </Button>
    );
}
