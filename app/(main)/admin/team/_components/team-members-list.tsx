'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Trash2, Shield, User as UserIcon, Crown } from 'lucide-react';
import { updateUserRole, removeUserFromLocation } from '../actions';
import { useRouter } from 'next/navigation';

interface TeamMember {
    id: string;
    userId: string;
    locationId: string;
    role: 'ADMIN' | 'MEMBER';
    createdAt: Date;
    invitedById: string | null;
    invitedAt: Date | null;
    user: {
        id: string;
        email: string;
        name: string | null;
        clerkId: string | null;
    };
}

interface TeamMembersListProps {
    members: TeamMember[];
    isAdmin: boolean;
    currentUserId?: string;
}

export function TeamMembersList({ members, isAdmin, currentUserId }: TeamMembersListProps) {
    const router = useRouter();
    const [loading, setLoading] = useState<string | null>(null);

    async function handleRoleChange(userId: string, newRole: 'ADMIN' | 'MEMBER') {
        setLoading(userId);
        await updateUserRole(userId, newRole);
        setLoading(null);
        router.refresh();
    }

    async function handleRemove(userId: string) {
        setLoading(userId);
        await removeUserFromLocation(userId);
        setLoading(null);
        router.refresh();
    }

    if (members.length === 0) {
        return (
            <div className="border rounded-lg p-12 text-center text-gray-500">
                <UserIcon className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <h3 className="text-lg font-medium mb-2">No team members</h3>
                <p>Invite users to give them access to this location.</p>
            </div>
        );
    }

    return (
        <div className="border rounded-lg overflow-hidden">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                        {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {members.map((member) => {
                        const isSelf = member.user.id === currentUserId;

                        return (
                            <TableRow key={member.id}>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                                            {member.user.name?.[0]?.toUpperCase() || member.user.email[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                {member.user.name || 'Unnamed User'}
                                                {isSelf && <Badge variant="outline" className="text-xs">You</Badge>}
                                            </div>
                                            <div className="text-sm text-gray-500">{member.user.email}</div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    {isAdmin && !isSelf ? (
                                        <Select
                                            value={member.role}
                                            onValueChange={(value) => handleRoleChange(member.user.id, value as 'ADMIN' | 'MEMBER')}
                                            disabled={loading === member.user.id}
                                        >
                                            <SelectTrigger className="w-32">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ADMIN">
                                                    <div className="flex items-center gap-2">
                                                        <Crown className="h-3 w-3" />
                                                        Admin
                                                    </div>
                                                </SelectItem>
                                                <SelectItem value="MEMBER">
                                                    <div className="flex items-center gap-2">
                                                        <UserIcon className="h-3 w-3" />
                                                        Member
                                                    </div>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Badge
                                            variant={member.role === 'ADMIN' ? 'default' : 'secondary'}
                                            className="gap-1"
                                        >
                                            {member.role === 'ADMIN' ? (
                                                <Crown className="h-3 w-3" />
                                            ) : (
                                                <UserIcon className="h-3 w-3" />
                                            )}
                                            {member.role === 'ADMIN' ? 'Admin' : 'Member'}
                                        </Badge>
                                    )}
                                </TableCell>
                                <TableCell className="text-gray-500">
                                    {member.createdAt.toLocaleDateString()}
                                </TableCell>
                                {isAdmin && (
                                    <TableCell className="text-right">
                                        {!isSelf && (
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                        disabled={loading === member.user.id}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Remove team member?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will remove {member.user.name || member.user.email}'s access to this location. They can be re-invited later.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction
                                                            onClick={() => handleRemove(member.user.id)}
                                                            className="bg-red-600 hover:bg-red-700"
                                                        >
                                                            Remove
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        )}
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
