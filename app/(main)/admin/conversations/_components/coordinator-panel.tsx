import { useState, useEffect } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import { generateAIDraft, generateMultiContextDraftAction, getContactContext, runAgentAction } from "../actions";
import { createPersistentDeal, findExistingDeal, removeConversationFromDeal } from "../../deals/actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Check, Info, Layers, Users, Home, Link as LinkIcon, AlertCircle, ExternalLink, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CONTACT_TYPE_CONFIG, ContactType, DEFAULT_CONTACT_TYPE } from "../../contacts/_components/contact-types";
import { EditContactDialog } from "../../contacts/_components/edit-contact-dialog";

interface CoordinatorPanelProps {
    conversation: Conversation;
    selectedConversations?: Conversation[]; // New Prop for Context Mode
    onDraftApproved: (text: string) => void;
    onDeselect?: (id: string) => void;
}

export function CoordinatorPanel({ conversation, selectedConversations, onDraftApproved, onDeselect }: CoordinatorPanelProps) {
    const [draft, setDraft] = useState("");
    const [reasoning, setReasoning] = useState("");
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Context Builder State
    const [dealTitle, setDealTitle] = useState("");
    const [dealContextId, setDealContextId] = useState<string | null>(null);

    // Context Display State
    const [contactContext, setContactContext] = useState<any>(null);
    const [loadingContext, setLoadingContext] = useState(false);

    // Agent State
    const [agentActions, setAgentActions] = useState<any[]>([]);
    const [runningAgent, setRunningAgent] = useState(false);

    const isContextMode = selectedConversations && selectedConversations.length > 0;

    // Auto-detect existing deal on selection change
    useEffect(() => {
        if (!selectedConversations || selectedConversations.length === 0) {
            setDealContextId(null);
            setDealTitle("");
            return;
        }

        const ids = selectedConversations.map(c => c.id);
        findExistingDeal(ids).then(deals => {
            if (deals && deals.length > 0) {
                // If we have a perfect match or any match, auto-bind to the top one
                // Ideally this should be user confirmation? For now auto-select for smooth UX
                setDealContextId(deals[0].id);
                setDealTitle(deals[0].title);
            } else {
                setDealContextId(null);
                setDealTitle("");
            }
        });
    }, [selectedConversations]);

    // Fetch Context on Load or Conversation Change
    useEffect(() => {
        if (!conversation?.contactId) return;

        setLoadingContext(true);
        getContactContext(conversation.contactId)
            .then(data => setContactContext(data))
            .catch(err => console.error("Failed to load context", err))
            .finally(() => setLoadingContext(false));
    }, [conversation.contactId]);

    const handleGenerate = async () => {
        setGenerating(true);
        setError(null);
        try {
            if (isContextMode) {
                // Multi-Context Flow
                let contextId = dealContextId;

                // Auto-create persistent deal if not exists
                if (!contextId) {
                    const ids = selectedConversations!.map(c => c.id);
                    const title = dealTitle || `Deal: ${selectedConversations![0].contactName} & others`;
                    const newContext = await createPersistentDeal(title, ids);
                    setDealContextId(newContext.id);
                    contextId = newContext.id;
                }

                // Generate Draft (targeting the primary user for now, or let UI choose)
                // For simplicity, we assume we are drafting to the ACTIVE conversation's contact
                // Determine target audience based on active conversation
                const target = 'LEAD'; // Default, TODO: Add UI selector
                const res = await generateMultiContextDraftAction(contextId!, target);
                setDraft(res.draft);
                setReasoning(res.reasoning);

            } else {
                // Single Context Flow
                const res = await generateAIDraft(conversation.id, conversation.contactId);
                setDraft(res.draft);
                setReasoning(res.reasoning);

                // Refresh context after generation (in case JIT sync created it)
                getContactContext(conversation.contactId).then(setContactContext);
            }
        } catch (e: any) {
            setError("Failed to generate draft. " + e.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleApprove = () => {
        if (!draft) return;
        onDraftApproved(draft);
        setDraft(""); // Clear after sending
        setReasoning("");
    };

    const handleRemoveParticipant = async (conversationId: string) => {
        if (dealContextId) {
            // Remove from persistent deal
            try {
                await removeConversationFromDeal(dealContextId, conversationId);
                // The UI might lag until re-fetch, but deselecting helps
            } catch (e) {
                console.error("Failed to remove from deal", e);
                // Should show toast?
            }
        }
        // Visually remove from selection
        onDeselect?.(conversationId);
    };

    const handleRunAgent = async () => {
        if (!conversation?.contactId) return;

        setRunningAgent(true);
        setError(null);
        setAgentActions([]);

        try {
            const result = await runAgentAction(conversation.id, conversation.contactId);

            if (result.success) {
                setReasoning(result.thought || "Agent completed.");
                setDraft(result.draft || "");
                setAgentActions(result.actions || []);

                // Refresh context after agent (may have updated fields)
                getContactContext(conversation.contactId).then(setContactContext);
            } else {
                setError(result.error || "Agent failed.");
            }
        } catch (e: any) {
            setError("Agent crashed: " + e.message);
        } finally {
            setRunningAgent(false);
        }
    };

    return (
        <div className="h-full bg-slate-50 border-l p-4 overflow-y-auto space-y-4 min-w-0">
            <div className="flex items-center gap-2 mb-4">
                {isContextMode ? (
                    <Layers className="h-5 w-5 text-indigo-600" />
                ) : (
                    <Sparkles className="h-5 w-5 text-purple-600" />
                )}
                <h3 className="font-bold text-lg">
                    {isContextMode ? (dealContextId ? "Deal Room" : "Deal Binding") : "AI Coordinator"}
                </h3>
            </div>

            {/* Context Card */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex justify-between items-center">
                        {isContextMode ? "Deal Scope" : "Contact Context"}
                        {!isContextMode && (
                            <Badge variant={contactContext ? "default" : "secondary"} className={contactContext ? "bg-green-600" : "bg-gray-400"}>
                                {loadingContext ? <Loader2 className="h-3 w-3 animate-spin" /> : (contactContext?.contact ? "Synced" : "Unsynced")}
                            </Badge>
                        )}
                    </CardTitle>
                    <CardDescription className="text-xs">Based on linked database records</CardDescription>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                    {isContextMode ? (
                        <div className="space-y-2">
                            <div className="text-xs font-semibold text-gray-500 uppercase">Linked Participants</div>
                            <div className="flex flex-wrap gap-1">
                                {selectedConversations?.map(c => (
                                    <Badge key={c.id} variant={c.id === conversation.id ? "default" : "secondary"} className="pr-1">
                                        <Users className="w-3 h-3 mr-1" />
                                        {c.contactName || c.contactId.substring(0, 8)}
                                        {onDeselect && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation(); // Prevents other clicks
                                                    handleRemoveParticipant(c.id);
                                                }}
                                                className="ml-1 p-0.5 hover:bg-slate-200 rounded-full transition-colors"
                                            >
                                                <X className="w-3 h-3 text-slate-500" />
                                            </button>
                                        )}
                                    </Badge>
                                ))}
                            </div>

                            {!dealContextId && (
                                <div className="pt-2">
                                    <label className="text-xs">Deal Title (Optional)</label>
                                    <input
                                        className="w-full text-xs p-1 border rounded"
                                        placeholder="e.g. Sale of Sea Caves Villa"
                                        value={dealTitle}
                                        onChange={(e) => setDealTitle(e.target.value)}
                                    />
                                </div>
                            )}

                            {dealContextId && (
                                <div className="pt-2">
                                    <Link href={`/admin/deals/${dealContextId}`} target="_blank">
                                        <Button variant="outline" size="sm" className="w-full text-indigo-600 border-indigo-200 bg-indigo-50">
                                            <ExternalLink className="w-4 h-4 mr-2" />
                                            Open Deal Room Workspace
                                        </Button>
                                    </Link>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div>
                            <span className="font-semibold text-xs text-muted-foreground block mb-1">Contact</span>
                            <div className="flex items-center gap-2 justify-between">
                                <div className="flex items-center gap-2">
                                    <Users className="h-4 w-4 text-gray-400" />
                                    {conversation.contactName || conversation.contactId}
                                </div>
                                {contactContext?.contact && (
                                    <EditContactDialog
                                        contact={contactContext.contact}
                                        leadSources={contactContext.leadSources}
                                        trigger={
                                            <Button variant="ghost" size="sm" className="h-6 px-2 text-blue-600">
                                                <ExternalLink className="h-3 w-3 mr-1" />
                                                View
                                            </Button>
                                        }
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* Requirements Display */}
                    {(() => {
                        const contactType = (contactContext?.contact?.contactType as ContactType) || DEFAULT_CONTACT_TYPE;
                        const config = CONTACT_TYPE_CONFIG[contactType];
                        const showRequirements = config?.visibleTabs.includes('requirements');

                        if (!showRequirements && contactContext?.contact) return null;

                        return (
                            <div className="pt-2 border-t mt-2">
                                <span className="font-semibold text-xs text-muted-foreground block mb-2">Requirements</span>
                                {loadingContext ? (
                                    <div className="text-xs text-gray-400">Loading...</div>
                                ) : contactContext?.contact ? (
                                    <div className="text-xs space-y-1">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Goal:</span>
                                            <span>{contactContext.contact.leadGoal || contactContext.contact.requirementStatus}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Budget:</span>
                                            <span>{contactContext.contact.requirementMinPrice} - {contactContext.contact.requirementMaxPrice}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Area:</span>
                                            <span className="truncate max-w-[150px]">{contactContext.contact.requirementDistrict}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500">Bedrooms:</span>
                                            <span>{contactContext.contact.requirementBedrooms}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <span className="text-xs italic text-gray-400">Not synced</span>
                                )}
                            </div>
                        );
                    })()}

                    {/* Property Context Display */}
                    <div className="pt-2 border-t mt-2">
                        <span className="font-semibold text-xs text-muted-foreground block mb-2">Property Activity</span>

                        {loadingContext ? (
                            <div className="flex items-center text-xs text-gray-400">
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                Loading context...
                            </div>
                        ) : contactContext?.contact ? (
                            <div className="space-y-2">
                                {/* Roles (Interested/Owner) */}
                                {contactContext.contact.propertyRoles?.length > 0 && contactContext.contact.propertyRoles.map((role: any) => (
                                    <div key={'role-' + role.id} className="text-xs flex items-start gap-1 p-1 bg-slate-100 rounded">
                                        <Home className="h-3 w-3 mt-0.5 text-blue-500 shrink-0" />
                                        <span>
                                            <span className="font-semibold capitalize">{role.role}:</span> {role.property.title}
                                        </span>
                                    </div>
                                ))}

                                {/* Viewings */}
                                {contactContext.contact.viewings?.length > 0 && contactContext.contact.viewings.map((viewing: any) => (
                                    <div key={'viewing-' + viewing.id} className="text-xs flex items-start gap-1 p-1 bg-purple-50 rounded">
                                        <Info className="h-3 w-3 mt-0.5 text-purple-500 shrink-0" />
                                        <span>
                                            <span className="font-semibold capitalize">Viewing:</span> {viewing.property.title}
                                            <span className="block text-gray-400 text-[10px]">
                                                {new Date(viewing.date).toLocaleDateString()}
                                            </span>
                                        </span>
                                    </div>
                                ))}

                                {/* Property ID Lists */}
                                {/* Helper to render string lists */}
                                {[
                                    { label: 'Inspected', list: contactContext.contact.propertiesInspected },
                                    { label: 'Emailed', list: contactContext.contact.propertiesEmailed },
                                    { label: 'Matched', list: contactContext.contact.propertiesMatched }
                                ].map(({ label, list }) => (
                                    list && list.length > 0 && (
                                        <div key={label} className="text-xs">
                                            <span className="font-semibold text-gray-500">{label}:</span>
                                            <span className="ml-1 text-gray-700">{list.length} properties</span>
                                            {/* Showing raw IDs/Strings might be messy, just showing count for now or first few */}
                                            {/* <div className="pl-2 border-l-2 text-[10px] text-gray-400 truncate">{list.join(", ")}</div> */}
                                        </div>
                                    )
                                ))}

                                {(!contactContext.contact.propertyRoles?.length && !contactContext.contact.viewings?.length &&
                                    !contactContext.contact.propertiesInspected?.length && !contactContext.contact.propertiesEmailed?.length) &&
                                    <div className="text-xs text-gray-400 italic">No linked property history.</div>
                                }
                            </div>
                        ) : (
                            <div className="text-xs text-gray-400 italic">
                                {contactContext?.contact ? "No properties linked." : "Contact not synced. Use AI to auto-import."}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Action Area */}
            <div className="space-y-3">
                <Button
                    onClick={handleGenerate}
                    disabled={generating}
                    className={`w-full text-white ${isContextMode ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                >
                    {generating ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Thinking...
                        </>
                    ) : (
                        <>
                            <Sparkles className="mr-2 h-4 w-4" />
                            {isContextMode ? "Generate Strategy" : "Generate Suggestion"}
                        </>
                    )}
                </Button>

                {/* Autonomous Agent Button */}
                {!isContextMode && (
                    <Button
                        onClick={handleRunAgent}
                        disabled={runningAgent || generating}
                        variant="outline"
                        className="w-full border-purple-400 text-purple-700 hover:bg-purple-50"
                    >
                        {runningAgent ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Agent Thinking...
                            </>
                        ) : (
                            <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                Run Agent (Autonomous)
                            </>
                        )}
                    </Button>
                )}

                {/* Agent Actions Summary */}
                {agentActions.length > 0 && (
                    <Alert className="bg-green-50 border-green-200">
                        <Check className="h-4 w-4 text-green-600" />
                        <AlertTitle className="text-green-800 text-sm">Agent Actions</AlertTitle>
                        <AlertDescription className="text-xs text-green-700 break-all">
                            {agentActions.map((a, i) => (
                                <div key={i}>• {a.tool}: {JSON.stringify(a.result?.message || a.result || a.error)}</div>
                            ))}
                        </AlertDescription>
                    </Alert>
                )}

                {error && (
                    <Alert variant="destructive">
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {reasoning && (
                    <Alert className="bg-blue-50 border-blue-200">
                        <Info className="h-4 w-4 text-blue-600" />
                        <AlertDescription className="text-xs text-blue-800">
                            {reasoning}
                        </AlertDescription>
                    </Alert>
                )}

                {draft && (
                    <div className="space-y-2 p-3 bg-white border rounded-md shadow-sm">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Draft Reply</label>
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="min-h-[120px] text-sm"
                        />
                        <Button onClick={handleApprove} className="w-full" variant="outline">
                            <Check className="mr-2 h-4 w-4 text-green-600" />
                            Approve & Send
                        </Button>
                    </div>
                )}
            </div>
        </div >
    );
}
