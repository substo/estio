'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
    getConversationParticipants,
    openConversationForGroupParticipant,
    prepareGroupParticipantSave,
    saveGroupParticipantContact,
} from '../actions';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, MessageSquare, Save, Users } from "lucide-react";
import { useToast } from '@/components/ui/use-toast';

interface GroupMembersListProps {
    conversationId: string;
}

type ParticipantRow = {
    id: string;
    role: string;
    displayName: string;
    identitySummary: string;
    participantJid?: string | null;
    lidJid?: string | null;
    phoneJid?: string | null;
    phoneDigits?: string | null;
    resolutionConfidence?: string | null;
    source?: string | null;
    lastSeenAt?: string | Date | null;
    linkedContact?: {
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        contactType: string | null;
    } | null;
    canSave: boolean;
    canOpenDirect: boolean;
    directChatLabel: string;
};

type SaveDialogState = {
    participantId: string;
    displayName: string;
    identitySummary: string;
    linkedContact?: ParticipantRow["linkedContact"];
    draft: { name: string; phone: string | null };
    matches: Array<{
        id: string;
        name: string | null;
        phone: string | null;
        email: string | null;
        contactType: string | null;
        lid: string | null;
        matchReason: string;
    }>;
};

export function GroupMembersList({ conversationId }: GroupMembersListProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [participants, setParticipants] = useState<ParticipantRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [saveDialogOpen, setSaveDialogOpen] = useState(false);
    const [saveDialogLoading, setSaveDialogLoading] = useState(false);
    const [saveDialogSubmitting, setSaveDialogSubmitting] = useState(false);
    const [saveDialogState, setSaveDialogState] = useState<SaveDialogState | null>(null);
    const [selectedMatchId, setSelectedMatchId] = useState<string>('');
    const [draftName, setDraftName] = useState('');
    const [draftPhone, setDraftPhone] = useState('');
    const [directChatLoadingId, setDirectChatLoadingId] = useState<string | null>(null);

    async function loadParticipants() {
        setLoading(true);
        try {
            const res = await getConversationParticipants(conversationId);
            if (res.success && res.participants) {
                setParticipants(res.participants as ParticipantRow[]);
            } else {
                toast({
                    title: "Group sync failed",
                    description: String(res.error || "Could not load group participants."),
                    variant: "destructive",
                });
            }
        } catch (error) {
            console.error(error);
            toast({
                title: "Group sync failed",
                description: "Could not load group participants.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadParticipants();
    }, [conversationId]);

    const selectedMatch = useMemo(
        () => saveDialogState?.matches.find((match) => match.id === selectedMatchId) || null,
        [saveDialogState, selectedMatchId]
    );

    async function handleOpenSaveDialog(participant: ParticipantRow) {
        setSaveDialogOpen(true);
        setSaveDialogLoading(true);
        setSaveDialogState(null);
        setSelectedMatchId('');
        setDraftName('');
        setDraftPhone('');

        try {
            const res = await prepareGroupParticipantSave(participant.id);
            if (!res.success || !res.participant || !res.draft) {
                throw new Error(String(res.error || "Could not prepare this participant."));
            }

            setSaveDialogState({
                participantId: res.participant.id,
                displayName: res.participant.displayName,
                identitySummary: res.participant.identitySummary,
                linkedContact: res.participant.linkedContact,
                draft: {
                    name: res.draft.name || "",
                    phone: res.draft.phone || "",
                },
                matches: Array.isArray(res.matches) ? res.matches : [],
            });
            setDraftName(res.draft.name || "");
            setDraftPhone(res.draft.phone || "");
        } catch (error: any) {
            console.error(error);
            setSaveDialogOpen(false);
            toast({
                title: "Could not open save flow",
                description: String(error?.message || "Please try again."),
                variant: "destructive",
            });
        } finally {
            setSaveDialogLoading(false);
        }
    }

    async function handleSaveParticipant(mode: 'create' | 'link') {
        if (!saveDialogState) return;
        if (mode === 'link' && !selectedMatchId) {
            toast({
                title: "Choose a contact",
                description: "Select one of the suggested contacts to link.",
                variant: "destructive",
            });
            return;
        }

        setSaveDialogSubmitting(true);
        try {
            const res = await saveGroupParticipantContact({
                participantId: saveDialogState.participantId,
                action: mode,
                contactId: mode === 'link' ? selectedMatchId : undefined,
                name: draftName,
                phone: draftPhone,
            });

            if (!res.success) {
                throw new Error(String(res.error || "Save failed."));
            }

            toast({
                title: mode === 'link' ? "Contact linked" : "Contact saved",
                description: mode === 'link'
                    ? "This group member is now linked to an existing contact."
                    : "A new contact was created from this group member.",
            });
            setSaveDialogOpen(false);
            await loadParticipants();
            router.refresh();
        } catch (error: any) {
            console.error(error);
            toast({
                title: "Save failed",
                description: String(error?.message || "Please try again."),
                variant: "destructive",
            });
        } finally {
            setSaveDialogSubmitting(false);
        }
    }

    async function handleOpenDirectChat(participant: ParticipantRow) {
        setDirectChatLoadingId(participant.id);
        try {
            const res = await openConversationForGroupParticipant(participant.id);
            if (!res.success || !res.conversationId) {
                throw new Error(String(res.error || "Direct chat is unavailable."));
            }
            router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
        } catch (error: any) {
            console.error(error);
            toast({
                title: "Direct chat unavailable",
                description: String(error?.message || "A trusted direct WhatsApp target is not available yet."),
                variant: "destructive",
            });
        } finally {
            setDirectChatLoadingId(null);
        }
    }

    if (loading) {
        return <div className="flex justify-center p-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
    }

    return (
        <>
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
                        participants.map((participant) => (
                            <div key={participant.id} className="rounded-md border p-2 space-y-2">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium truncate text-foreground">
                                                {participant.displayName || "Unknown"}
                                            </span>
                                            {participant.role === 'admin' ? (
                                                <Badge variant="outline" className="text-[9px] h-4 px-1 text-blue-600 border-blue-200 bg-blue-50">
                                                    Admin
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground truncate">
                                            {participant.identitySummary}
                                        </div>
                                        <div className="text-[10px] text-muted-foreground truncate">
                                            {participant.linkedContact
                                                ? `Linked: ${participant.linkedContact.name || participant.linkedContact.phone || "Existing contact"}`
                                                : "Shadow member only"}
                                        </div>
                                    </div>
                                    {participant.linkedContact ? (
                                        <Link
                                            href={`/admin/contacts/${encodeURIComponent(participant.linkedContact.id)}/edit`}
                                            className="text-[10px] text-primary hover:underline whitespace-nowrap"
                                        >
                                            Open Contact
                                        </Link>
                                    ) : null}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-[11px]"
                                        onClick={() => handleOpenSaveDialog(participant)}
                                    >
                                        <Save className="mr-1.5 h-3.5 w-3.5" />
                                        {participant.linkedContact ? "Manage Contact" : "Save Contact"}
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="h-7 text-[11px]"
                                        disabled={!participant.canOpenDirect || directChatLoadingId === participant.id}
                                        onClick={() => handleOpenDirectChat(participant)}
                                    >
                                        {directChatLoadingId === participant.id ? (
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        {participant.directChatLabel}
                                    </Button>
                                </div>
                                {!participant.canOpenDirect ? (
                                    <div className="text-[10px] text-muted-foreground">
                                        Direct chat is unavailable until Evolution exposes a trusted direct number.
                                    </div>
                                ) : null}
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogContent className="sm:max-w-[640px]">
                    <DialogHeader>
                        <DialogTitle>Save Group Member</DialogTitle>
                        <DialogDescription>
                            Save this member as a real contact or link them to an existing one.
                        </DialogDescription>
                    </DialogHeader>

                    {saveDialogLoading || !saveDialogState ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="rounded-md border p-3 text-sm">
                                <div className="font-medium">{saveDialogState.displayName}</div>
                                <div className="text-xs text-muted-foreground mt-1">{saveDialogState.identitySummary}</div>
                                {saveDialogState.linkedContact ? (
                                    <div className="text-xs text-muted-foreground mt-2">
                                        Already linked to {saveDialogState.linkedContact.name || saveDialogState.linkedContact.phone || "an existing contact"}.
                                    </div>
                                ) : null}
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Name</label>
                                    <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Contact name" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Phone</label>
                                    <Input
                                        value={draftPhone}
                                        onChange={(event) => setDraftPhone(event.target.value)}
                                        placeholder="Leave blank if unavailable"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="text-xs font-medium">Likely existing contacts</div>
                                {saveDialogState.matches.length === 0 ? (
                                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                                        No likely matches found. You can create a new contact.
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-[240px] overflow-y-auto">
                                        {saveDialogState.matches.map((match) => {
                                            const isSelected = selectedMatchId === match.id;
                                            return (
                                                <button
                                                    key={match.id}
                                                    type="button"
                                                    onClick={() => setSelectedMatchId(match.id)}
                                                    className={`w-full rounded-md border p-3 text-left transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'}`}
                                                >
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-medium truncate">{match.name || "Unnamed contact"}</div>
                                                            <div className="text-xs text-muted-foreground truncate">
                                                                {match.phone || match.email || match.lid || "No direct details"}
                                                            </div>
                                                        </div>
                                                        <Badge variant="secondary" className="text-[10px]">
                                                            {match.matchReason}
                                                        </Badge>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <DialogFooter className="gap-2 sm:justify-between">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={saveDialogLoading || saveDialogSubmitting}
                            onClick={() => setSaveDialogOpen(false)}
                        >
                            Cancel
                        </Button>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                disabled={saveDialogLoading || saveDialogSubmitting || !selectedMatch}
                                onClick={() => handleSaveParticipant('link')}
                            >
                                {saveDialogSubmitting && selectedMatch ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                Link Selected
                            </Button>
                            <Button
                                type="button"
                                disabled={saveDialogLoading || saveDialogSubmitting}
                                onClick={() => handleSaveParticipant('create')}
                            >
                                {saveDialogSubmitting && !selectedMatch ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                Create Contact
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
