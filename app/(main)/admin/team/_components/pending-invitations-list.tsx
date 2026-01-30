'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, Trash2, Clock } from 'lucide-react';
import { revokeInvitation } from '../actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface Invitation {
    id: string;
    emailAddress: string;
    status: string;
    createdAt: number;
    publicMetadata: {
        role?: string;
    };
}

interface PendingInvitationsListProps {
    invitations: Invitation[];
    isAdmin: boolean;
}

export function PendingInvitationsList({ invitations, isAdmin }: PendingInvitationsListProps) {
    const router = useRouter();

    if (invitations.length === 0) return null;

    const handleRevoke = async (invitationId: string) => {
        const result = await revokeInvitation(invitationId);
        if (result.success) {
            toast.success('Invitation revoked');
            router.refresh();
        } else {
            toast.error(result.error || 'Failed to revoke invitation');
        }
    };

    return (
        <Card className="border-dashed">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Pending Invitations
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {invitations.map((inv) => (
                    <div
                        key={inv.id}
                        className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
                    >
                        <div className="flex items-center gap-3">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <div className="text-sm font-medium">{inv.emailAddress}</div>
                                <div className="text-xs text-muted-foreground">
                                    Sent{' '}
                                    <span suppressHydrationWarning>
                                        {new Date(inv.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                                {inv.publicMetadata?.role || 'MEMBER'}
                            </Badge>
                            {isAdmin && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => handleRevoke(inv.id)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
