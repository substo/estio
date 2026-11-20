"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, X, RefreshCw } from "lucide-react";
import { useState } from "react";
import { revokeInvitation, resendInvitation } from "../actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format } from "date-fns";
import type { Invitation } from "@clerk/nextjs/server";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Using 'any' for invitation type if strict type is hard to import client-side, 
// but we can try to use the shape we know.
interface PendingInvitationsListProps {
    invitations: any[]; // Clerk Invitation type
    isAdmin: boolean;
}

export function PendingInvitationsList({ invitations, isAdmin }: PendingInvitationsListProps) {
    const router = useRouter();
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [resendingId, setResendingId] = useState<string | null>(null);
    const [invitationToRevoke, setInvitationToRevoke] = useState<string | null>(null);

    if (invitations.length === 0) return null;

    async function executeRevoke() {
        if (!invitationToRevoke) return;
        const id = invitationToRevoke;
        setInvitationToRevoke(null);
        setRevokingId(id);

        const result = await revokeInvitation(id);
        setRevokingId(null);

        if (result.success) {
            toast.success("Invitation revoked");
            router.refresh();
        } else {
            toast.error(result.error || "Failed to revoke");
        }
    }

    async function handleResend(id: string) {
        setResendingId(id);
        const result = await resendInvitation(id);
        setResendingId(null);

        if (result.success) {
            toast.success("Invitation resent");
            router.refresh();
        } else {
            toast.error(result.error || "Failed to resend");
        }
    }

    return (
        <div className="mb-8">
            <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    Pending Invitations
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                    Users who have been invited via email but have not yet accepted.
                </p>
            </div>
            <div className="grid gap-4">
                {invitations.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between p-4 border rounded-lg bg-muted/20">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center text-orange-600">
                                <Mail className="h-5 w-5" />
                            </div>
                            <div>
                                <div className="font-medium">{inv.emailAddress}</div>
                                <div className="text-sm text-muted-foreground flex items-center gap-2">
                                    <span>Sent {format(new Date(inv.createdAt), 'MMM d, yyyy')}</span>
                                    <Badge variant="outline" className="text-xs">{inv.publicMetadata?.role as string || 'MEMBER'}</Badge>
                                </div>
                            </div>
                        </div>
                        {isAdmin && (
                            <div className="flex gap-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleResend(inv.id)}
                                    disabled={resendingId === inv.id || revokingId === inv.id}
                                    className="text-blue-500 hover:text-blue-600 hover:bg-blue-50"
                                >
                                    <RefreshCw className={`h-4 w-4 mr-2 ${resendingId === inv.id ? 'animate-spin' : ''}`} />
                                    {resendingId === inv.id ? "Resending..." : "Resend"}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setInvitationToRevoke(inv.id)}
                                    disabled={revokingId === inv.id || resendingId === inv.id}
                                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                >
                                    <X className="h-4 w-4 mr-2" />
                                    {revokingId === inv.id ? "Revoking..." : "Revoke"}
                                </Button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <AlertDialog open={!!invitationToRevoke} onOpenChange={(open) => !open && setInvitationToRevoke(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke Invitation</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to revoke this invitation? The link will no longer be valid and the user will not be able to join using it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={executeRevoke} className="bg-red-600 hover:bg-red-700 text-white">
                            Revoke Invitation
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
