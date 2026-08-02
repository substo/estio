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
import { Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { updateMemberContactAccess, updateUserCalendar, updateUserRole } from '../actions';
import { CreateCalendarDialog } from './create-calendar-dialog';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { RemoveUserDialog } from './offboarding-preview';
import { AssignmentRecovery } from './assignment-recovery';

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
        clerkId: string | null;
        createdAt: Date;
        ghlCalendarId: string | null;
        ghlUserId: string | null;
        locationRoles?: { locationId: string; role: 'ADMIN' | 'MEMBER'; invitedById: string | null; contactAccessScope: 'ASSIGNED_ONLY' | 'LOCATION_WIDE' }[];
    };
    calendars: Calendar[];
    isAdmin: boolean;
    isCurrentUser: boolean;
    activeLocation: { id: string; name: string | null };
    removalMembers: { id: string; email: string; name: string }[];
    hasOtherMembership: boolean;
}

function getDisplayName(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'Unnamed User';
}

function getInitials(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    if (user.firstName) return user.firstName[0].toUpperCase();
    return user.email[0].toUpperCase();
}

export function TeamMemberCard({ user, calendars, isAdmin, isCurrentUser, activeLocation, removalMembers, hasOtherMembership }: TeamMemberCardProps) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [selectedCalendar, setSelectedCalendar] = useState(user.ghlCalendarId || "none");
    const [showManagement, setShowManagement] = useState(false);

    const roleData = user.locationRoles?.find((entry) => entry.locationId === activeLocation.id);
    const role = roleData?.role || 'MEMBER';
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

    const handleRoleChange = async (value: 'ADMIN' | 'MEMBER') => {
        setLoading(true);
        const result = await updateUserRole(user.id, value);
        if (result.success) {
            toast.success(`Role updated to ${value}`);
            router.refresh();
        } else {
            toast.error("Failed to update role");
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
                            {!isProfileComplete && <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-200 border-none text-xs">Profile Incomplete</Badge>}
                        </CardTitle>
                        <div className="text-sm text-muted-foreground">{user.email}</div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-expanded={showManagement}
                        aria-controls={`team-user-management-${user.id}`}
                        onClick={() => setShowManagement((current) => !current)}
                    >
                        Manage user
                        {showManagement ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
                    </Button>
                    {showManagement && isAdmin && !isCurrentUser && (
                        <Select
                            value={role}
                            onValueChange={(val: 'ADMIN' | 'MEMBER') => handleRoleChange(val)}
                            disabled={loading}
                        >
                            <SelectTrigger className="w-[100px] h-8 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ADMIN">Admin</SelectItem>
                                <SelectItem value="MEMBER">Member</SelectItem>
                            </SelectContent>
                        </Select>
                    )}

                </div>
            </CardHeader>
            {showManagement && <CardContent id={`team-user-management-${user.id}`} className="space-y-4 border-t pt-4">
                {isAdmin && role === 'MEMBER' && (
                    <form action={updateMemberContactAccess} className="mb-4 flex items-end gap-2 rounded-md border p-3">
                        <input type="hidden" name="userId" value={user.id} />
                        <div className="space-y-1">
                            <label htmlFor={`contact-access-${user.id}`} className="text-xs font-medium">Contact visibility</label>
                            <select
                                id={`contact-access-${user.id}`}
                                name="contactAccessScope"
                                defaultValue={roleData?.contactAccessScope || 'ASSIGNED_ONLY'}
                                className="h-9 rounded-md border bg-background px-3 text-sm"
                            >
                                <option value="ASSIGNED_ONLY">Assigned contacts only</option>
                                <option value="LOCATION_WIDE">All location contacts</option>
                            </select>
                        </div>
                        <Button type="submit" variant="outline" size="sm">Save contact access</Button>
                        <p className="text-xs text-muted-foreground">Location-wide members can view all contacts, but manage only their own assignments.</p>
                    </form>
                )}
                <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                        Joined <span suppressHydrationWarning>{user.createdAt.toLocaleDateString()}</span>
                        {user.ghlUserId && (
                            <span className="ml-2 text-green-600">• GHL Linked</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">GHL Calendar:</span>
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
                {isAdmin && <AssignmentRecovery sourceEmail={user.email} />}
                {isAdmin && !isCurrentUser && roleData && (
                    <div className="flex items-center justify-between rounded-md border border-red-200 p-3">
                        <div>
                            <p className="text-sm font-medium">Location access</p>
                            <p className="text-xs text-muted-foreground">Remove this member without deleting their User identity.</p>
                        </div>
                        <RemoveUserDialog
                            source={{ id: user.id, email: user.email, name: getDisplayName(user) }}
                            activeLocation={activeLocation}
                            members={removalMembers}
                            hasOtherMembership={hasOtherMembership}
                        />
                    </div>
                )}
            </CardContent>}
        </Card>
    );
}
