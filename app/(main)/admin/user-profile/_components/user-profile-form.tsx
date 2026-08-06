'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { completeUserProfile } from '@/app/(main)/admin/profile-actions';
import { Loader2 } from 'lucide-react';

interface UserProfileFormProps {
    initialData: {
        firstName: string;
        lastName: string;
        timeZone: string;
    };
}

export function UserProfileForm({ initialData }: UserProfileFormProps) {
    const [isPending, startTransition] = useTransition();
    const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setStatus(null);
        const formData = new FormData(e.currentTarget);

        startTransition(async () => {
            const result = await completeUserProfile(formData);
            if (result.success) {
                setStatus({ type: 'success', message: 'Your personal details have been saved.' });
            } else {
                setStatus({ type: 'error', message: result.error || 'We could not save your changes. Please try again.' });
            }
        });
    };

    return (
        <section aria-labelledby="personal-details-heading">
            <Card className="w-full">
                <CardHeader className="pb-4">
                    <h2 id="personal-details-heading" className="text-xl font-semibold leading-none tracking-tight">Personal details</h2>
                    <CardDescription>
                        Keep your name and local time accurate across Estio.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">First name</Label>
                            <Input
                                id="firstName"
                                name="firstName"
                                defaultValue={initialData.firstName}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Last name</Label>
                            <Input
                                id="lastName"
                                name="lastName"
                                defaultValue={initialData.lastName}
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="timeZone">Time zone</Label>
                        <Input
                            id="timeZone"
                            name="timeZone"
                            defaultValue={initialData.timeZone}
                            placeholder="For example, Europe/Nicosia"
                            required
                            list="common-timezones"
                        />
                        <datalist id="common-timezones">
                            <option value="Europe/Nicosia" />
                            <option value="Europe/Athens" />
                            <option value="Europe/London" />
                            <option value="UTC" />
                            <option value="Asia/Dubai" />
                            <option value="America/New_York" />
                        </datalist>
                        <p className="text-xs text-muted-foreground">
                            Used to show appointments and schedules in your local time.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                        <div
                            role={status?.type === 'error' ? 'alert' : 'status'}
                            aria-live="polite"
                            className={status?.type === 'error' ? 'text-sm text-destructive' : 'text-sm text-green-700 dark:text-green-400'}
                        >
                            {isPending ? 'Saving your changes…' : status?.message}
                        </div>
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isPending ? 'Saving changes…' : 'Save changes'}
                        </Button>
                    </div>
                    </form>
                </CardContent>
            </Card>
        </section>
    );
}
