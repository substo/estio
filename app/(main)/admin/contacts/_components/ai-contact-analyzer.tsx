
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Copy, Check, Loader2, Phone } from "lucide-react";
import { analyzeContactAction } from "../ai-actions";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea"; // Or generic display
import { toast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";

export function AiContactAnalyzer({ contactId, locationId }: { contactId: string, locationId: string }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);

    const handleAnalyze = async () => {
        setLoading(true);
        try {
            const res = await analyzeContactAction(contactId, locationId);
            if (res.success && res.data) {
                setResult(res.data);
                setOpen(true); // Open result dialog
                toast({ title: "Analysis Complete", description: "Contact requirements updated." });
            } else {
                toast({ title: "Analysis Failed", description: res.message || "Unknown error", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Failed to connect to server.", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const CopyButton = ({ text, label }: { text: string, label: string }) => {
        const [copied, setCopied] = useState(false);
        const copy = () => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            toast({ title: "Copied!", description: `${label} copied to clipboard.` });
        };
        return (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={copy}>
                {copied ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                {copied ? "Copied" : "Copy"}
            </Button>
        );
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAnalyze}
                disabled={loading}
                className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
                {loading ? "Analyzing..." : "AI Analyze"}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-indigo-600" />
                            Martin's Outreach Assistant
                        </DialogTitle>
                        <DialogDescription>
                            AI-generated contact details and outreach drafts.
                        </DialogDescription>
                    </DialogHeader>

                    {result && (
                        <div className="space-y-6 pt-2">
                            {/* Phone Contact Section */}
                            <div className="bg-slate-50 p-4 rounded-lg border space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="font-semibold text-sm flex items-center gap-2">
                                        <Phone className="w-4 h-4" /> Phone Contact Entry
                                    </h4>
                                    <CopyButton
                                        text={`First Name: ${result.phoneContactEntry?.firstName}\nLast Name: ${result.phoneContactEntry?.lastName}`}
                                        label="Full Entry"
                                    />
                                </div>
                                <div className="grid grid-cols-1 gap-2 text-sm">
                                    <div className="flex justify-between items-center bg-white p-2 rounded border">
                                        <span className="text-muted-foreground w-20">First:</span>
                                        <span className="font-medium flex-1 select-all">{result.phoneContactEntry?.firstName}</span>
                                        <CopyButton text={result.phoneContactEntry?.firstName} label="First Name" />
                                    </div>
                                    <div className="flex justify-between items-center bg-white p-2 rounded border">
                                        <span className="text-muted-foreground w-20">Last:</span>
                                        <span className="font-medium flex-1 select-all">{result.phoneContactEntry?.lastName}</span>
                                        <CopyButton text={result.phoneContactEntry?.lastName} label="Last Name" />
                                    </div>
                                </div>
                            </div>

                            {/* Drafts Section */}
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Step 1: Icebreaker</Label>
                                        <CopyButton text={result.drafts?.icebreaker} label="Icebreaker" />
                                    </div>
                                    <div className="p-3 bg-muted/30 rounded-md text-sm whitespace-pre-wrap font-mono border">
                                        {result.drafts?.icebreaker}
                                    </div>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground">Step 2: Qualifier</Label>
                                        <CopyButton text={result.drafts?.qualifier} label="Qualifier" />
                                    </div>
                                    <div className="p-3 bg-muted/30 rounded-md text-sm whitespace-pre-wrap font-mono border">
                                        {result.drafts?.qualifier}
                                    </div>
                                </div>
                            </div>

                            {/* CRM Summary */}
                            <div className="bg-blue-50/50 p-3 rounded border border-blue-100">
                                <div className="flex items-center justify-between mb-1">
                                    <Label className="text-xs font-semibold text-blue-700">CRM Summary Note</Label>
                                    <CopyButton
                                        text={`${new Date().toLocaleDateString('en-GB')} Martin: ${result.crmSummary}`}
                                        label="CRM Note"
                                    />
                                </div>
                                <p className="text-sm text-blue-800">
                                    {new Date().toLocaleDateString('en-GB')} Martin: {result.crmSummary}
                                </p>
                            </div>

                            {/* Requirements Extracted Badge */}
                            <div className="flex flex-wrap gap-2 text-xs">
                                <span className="text-muted-foreground">Extracted:</span>
                                {Object.entries(result.requirements || {}).map(([k, v]) =>
                                    v && v !== 'Any' && v !== 'Any District' ? (
                                        <Badge key={k} variant="secondary">{k}: {String(v)}</Badge>
                                    ) : null
                                )}
                            </div>

                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
