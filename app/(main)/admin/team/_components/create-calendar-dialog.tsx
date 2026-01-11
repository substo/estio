'use client';

import { useState } from 'react';
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
import { Plus, Loader2 } from 'lucide-react';
import { createGHLCalendarForUser } from '../actions';
import { useToast } from '@/components/ui/use-toast';

interface CreateCalendarDialogProps {
    userId: string;
    userName: string;
    onSuccess: (calendarId: string) => void;
}

export function CreateCalendarDialog({ userId, userName, onSuccess }: CreateCalendarDialogProps) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [name, setName] = useState(`${userName}'s Calendar`);
    const [duration, setDuration] = useState(30);
    const { toast } = useToast();

    async function handleCreate() {
        if (!name || !userId) return;

        setIsLoading(true);
        try {
            const result = await createGHLCalendarForUser(userId, {
                name,
                slotDuration: Number(duration)
            });

            if (result.success) {
                toast({
                    title: "Success",
                    description: result.message,
                });
                onSuccess(result.message || '');
                setOpen(false);
            } else {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: result.message || "Failed to create calendar",
                });
            }
        } catch (error) {
            console.error(error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "An unexpected error occurred",
            });
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                    <Plus className="h-4 w-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Create GHL Calendar</DialogTitle>
                    <DialogDescription>
                        Create a new service calendar in GoHighLevel for {userName}.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">
                            Name
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="col-span-3"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="duration" className="text-right">
                            Duration
                        </Label>
                        <div className="col-span-3 flex items-center gap-2">
                            <Input
                                id="duration"
                                type="number"
                                value={duration}
                                onChange={(e) => setDuration(Number(e.target.value))}
                                className="w-20"
                            />
                            <span className="text-sm text-muted-foreground">minutes</span>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Create & Link
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
