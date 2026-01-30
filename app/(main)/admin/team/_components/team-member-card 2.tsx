'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Calendar, Crown, User as UserIcon } from 'lucide-react';
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
import { updateUserCalendar, removeUserFromLocation } from '../actions';
import { CreateCalendarDialog } from './create-calendar-dialog';
import { EditTeamMemberDialog } from './edit-team-member-dialog';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface Calendar {
    id: string;
    name: string;
}

interface TeamMemberCardProps {
    user: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        phone: string | null;
        clerkId: string | null;
        createdAt: Date;
        ghlCalendarId: string | null;
        ghlUserId: string | null;
        locationRoles?: { role: 'ADMIN' | 'MEMBER' }[];
    };
    calendars: Calendar[];
    isAdmin: boolean;
    isCurrentUser: boolean;
}

// Helper to get display name
function getDisplayName(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'Unnamed User';
}

// Helper to get initials
function getInitials(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    if (user.firstName) return user.firstName[0].toUpperCase();
    return user.email[0].toUpperCase();
}

export function TeamMemberCard({ user, calendars, isAdmin, isCurrentUser }: TeamMemberCardProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [selectedCalendar, setSelectedCalendar] = useState(user.ghlCalendarId || "none");

    const role = user.locationRoles?.[0]?.role || 'MEMBER';
    const isProfileComplete = !!(user.firstName && user.lastName);

    const handleCalendarChange = async (value: string) => {
        setLoading(true);
        const calendarId = value === "none" ? null : value;
        setSelectedCalendar(value);

        const result = await updateUserCalendar(user.id, calendarId);

        if (result.success) {
            toast.success("Calendar updated");
        } else {
            toast.error("Failed to update calendar");
            setSelectedCalendar(user.ghlCalendarId || "none");
        }
        setLoading(false);
    };

    const handleRemove = async () => {
        setLoading(true);
        const result = await removeUserFromLocation(user.id);
        if (result.success) {
            toast.success("User removed");
            router.refresh();
        } else {
            toast.error(result.error || "Failed to remove user");
        }
        setLoading(false);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium">
                        {getInitials(user)}
                    </div>
                    <div>
                        <CardTitle className="text-base font-medium flex items-center gap-2">
                            {getDisplayName(user)}
                            {isCurrentUser && <Badge variant="outline" className="text-xs">You</Badge>}
                            {role === 'ADMIN' && <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200 border-none text-xs">Admin</Badge>}
                            {!isProfileComplete && <Badge variant="destructive" className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-none text-xs">Profile Incomplete</Badge>}
                        </CardTitle>
                        <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {isAdmin && !isCurrentUser && (
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    disabled={loading}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Remove team member?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will remove {getDisplayName(user)}'s access to this location.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                        onClick={handleRemove}
                                        className="bg-red-600 hover:bg-red-700"
                                    >
                                        Remove
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    )}
                    {isAdmin && (
                        <EditTeamMemberDialog user={user} />
                    )}
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                        Joined <span suppressHydrationWarning>{user.createdAt.toLocaleDateString()}</span>
                        {user.ghlUserId && (
                            <span className="ml-2 text-green-600">• GHL Linked</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Calendar:</span>
                        <Select
                            value={selectedCalendar}
                            onValueChange={handleCalendarChange}
                            disabled={loading}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Select Calendar" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {calendars.map((cal) => (
                                    <SelectItem key={cal.id} value={cal.id}>
                                        {cal.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <CreateCalendarDialog
                            userId={user.id}
                            userName={getDisplayName(user)}
                            onSuccess={() => {
                                router.refresh();
                            }}
                        />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
