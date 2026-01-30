'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { completeUserProfile } from '@/app/(main)/admin/profile-actions';
import { useToast } from '@/components/ui/use-toast';
import { Loader2 } from 'lucide-react';

interface UserProfileFormProps {
    initialData: {
        firstName: string;
        lastName: string;
        phone: string;
        email: string;
    };
}

export function UserProfileForm({ initialData }: UserProfileFormProps) {
    const [isPending, startTransition] = useTransition();
    const { toast } = useToast();

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        startTransition(async () => {
            const result = await completeUserProfile(formData);
            if (result.success) {
                toast({
                    title: "Profile Updated",
                    description: "Your profile has been updated successfully.",
                });
            } else {
                toast({
                    title: "Error",
                    description: result.error || "Failed to update profile",
                    variant: "destructive",
                });
            }
        });
    };

    return (
        <Card className="w-full">
            <CardHeader className="pb-4">
                <CardTitle>Team Profile Details</CardTitle>
                <CardDescription>
                    Update your internal team profile details. These are synced with GoHighLevel.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">First Name</Label>
                            <Input
                                id="firstName"
                                name="firstName"
                                defaultValue={initialData.firstName}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Last Name</Label>
                            <Input
                                id="lastName"
                                name="lastName"
                                defaultValue={initialData.lastName}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone Number</Label>
                            <Input
                                id="phone"
                                name="phone"
                                type="tel"
                                defaultValue={initialData.phone}
                                disabled
                                className="bg-muted text-muted-foreground"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Phone number is managed via your account verification settings.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                value={initialData.email}
                                disabled
                                className="bg-muted text-muted-foreground"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Email is managed via your account settings.
                            </p>
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isPending ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
