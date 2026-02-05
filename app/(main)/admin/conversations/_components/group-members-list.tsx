'use client';

import { useState, useEffect } from 'react';
import { getConversationParticipants } from '../actions';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { EditContactDialog } from "../../contacts/_components/edit-contact-dialog";

interface GroupMembersListProps {
    conversationId: string;
}

export function GroupMembersList({ conversationId }: GroupMembersListProps) {
    const [participants, setParticipants] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        setLoading(true);
        getConversationParticipants(conversationId)
            .then(res => {
                if (mounted && res.success && res.participants) {
                    setParticipants(res.participants);
                }
            })
            .catch(console.error)
            .finally(() => {
                if (mounted) setLoading(false);
            });
        return () => { mounted = false; };
    }, [conversationId]);

    if (loading) {
        return <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <Card className="shadow-none border-border/50">
            <CardHeader className="p-3 pb-1.5 border-b mb-1">
                <CardTitle className="text-xs font-semibold flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                    Group Participants ({participants.length})
                </CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                {participants.length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">
                        No participants synced yet.
                    </div>
                ) : (
                    participants.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 group">
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-xs font-medium truncate max-w-[140px] text-foreground">
                                    {p.contact.name || "Unknown"}
                                </span>
                                <span className="text-[10px] text-muted-foreground truncate">
                                    {p.contact.phone || p.contact.email}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {p.role === 'admin' && (
                                    <Badge variant="outline" className="text-[9px] h-4 px-1 text-blue-600 border-blue-200 bg-blue-50">
                                        Admin
                                    </Badge>
                                )}
                                <EditContactDialog
                                    contact={p.contact}
                                    leadSources={[]} // Optional: fetch sources if needed
                                    trigger={
                                        <button className="text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 transition-opacity">
                                            View
                                        </button>
                                    }
                                />
                            </div>
                        </div>
                    ))
                )}
            </CardContent>
        </Card>
    );
}
