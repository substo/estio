'use client';

import { useClerk } from '@clerk/nextjs';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export function AccountSecurityCard({ primaryEmail }: { primaryEmail: string }) {
    const clerk = useClerk();

    return (
        <section id="account-security" aria-labelledby="account-security-heading" className="scroll-mt-6">
            <Card>
                <CardHeader>
                    <h2 id="account-security-heading" className="text-xl font-semibold leading-none tracking-tight">Account security</h2>
                    <CardDescription>
                        Your email, sign-in methods, password and security are managed in your secure account settings.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="text-sm font-medium">Primary sign-in email</p>
                        <p className="truncate text-sm text-muted-foreground">{primaryEmail || 'Not available'}</p>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        className="w-full shrink-0 sm:w-auto"
                        aria-label="Manage sign-in and security"
                        onClick={() => clerk.openUserProfile({ apiKeysProps: { hide: true } })}
                    >
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Manage sign-in and security
                    </Button>
                </CardContent>
            </Card>
        </section>
    );
}
